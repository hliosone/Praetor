// M4 link: the consortium contracts on the real 4-node FISCO chain (spec 04, non-SM): governance bootstrap and the
// deploy whitelist, FISCO's ms clock, a freeze from proposal to Ready to the outbox to delivered, 10-block log
// windows, and digests byte-identical to the TS protocol (so Base accepts FISCO-collected signatures).
import { describe, it, expect, beforeAll } from 'vitest';
import { keccak256, toHex, decodeAbiParameters, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  bootstrapGovernance, deployConsortium, fiscoClients, sendFisco, deployFisco, getLogsChunked, fiscoAbis, fiscoBytecodes,
  COMMITTEE, CONTRACT_AUTH, committeeAbi, authAbi, type ConsortiumDeployment,
} from '@praetor/fisco-client';
import { digest, praetorDomain, types } from '@praetor/protocol';
import { localKey } from './lib/praetor.js';

const RPC = 'http://10.88.1.10:8545';
const HOOK = '0x00000000000000000000000000000000DeaDBeef' as Address;
const k = (r: string) => localKey(r);
const a = (r: string) => privateKeyToAccount(k(r)).address;
let d: ConsortiumDeployment;
const clients = (key: Hex) => { const c = fiscoClients(RPC, key); return { pub: c.pub as PublicClient, w: c.wallet as WalletClient }; };

beforeAll(async () => {
  await bootstrapGovernance(RPC, { admin: k('BANK_FISCO_KEY'), regulator: k('REGULATOR_FISCO_KEY'), operator: k('OPERATOR_FISCO_KEY') },
    [a('DEPLOYER_KEY'), a('WEID_ADMIN_KEY'), a('WECROSS_FISCO_KEY')]);
  d = await deployConsortium(RPC, {
    deployerKey: k('DEPLOYER_KEY'),
    members: [
      { fiscoAccount: a('BANK_FISCO_KEY'), baseSigner: a('BANK_BASE_SIGNER_KEY') },
      { fiscoAccount: a('REGULATOR_FISCO_KEY'), baseSigner: a('REGULATOR_BASE_SIGNER_KEY') },
      { fiscoAccount: a('OPERATOR_FISCO_KEY'), baseSigner: a('OPERATOR_BASE_SIGNER_KEY') },
    ],
    baseHook: HOOK, domainName: 'Praetor-it', router: a('WECROSS_FISCO_KEY'), relayer: a('RELAYER_FISCO_KEY'),
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  });
}, 600_000);

describe('FISCO governance (Q22)', () => {
  it('has regulator and operator as governors and deploys on a whitelist', async () => {
    const { pub } = clients(k('DEPLOYER_KEY'));
    expect(await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [a('REGULATOR_FISCO_KEY')] })).toBe(true);
    expect(await pub.readContract({ address: COMMITTEE, abi: committeeAbi, functionName: 'isGovernor', args: [a('OPERATOR_FISCO_KEY')] })).toBe(true);
    expect(await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'deployType' })).toBe(1n);
    for (const r of ['DEPLOYER_KEY', 'WEID_ADMIN_KEY', 'WECROSS_FISCO_KEY']) {
      expect(await pub.readContract({ address: CONTRACT_AUTH, abi: authAbi, functionName: 'hasDeployAuth', args: [a(r)] }), r).toBe(true);
    }
  });

  it('refuses a deploy from an account outside the whitelist', async () => {
    const { pub, w } = clients(generatePrivateKey());
    await expect(deployFisco(pub, w, fiscoAbis.MemberRegistry as never, fiscoBytecodes.MemberRegistry)).rejects.toThrow();
  });
});

describe('consortium boards on FISCO', () => {
  it('converts FISCO\'s millisecond clock to seconds', async () => {
    const { pub } = clients(k('DEPLOYER_KEY'));
    const t = await pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'chainTimeSeconds' });
    expect(Math.abs(Number(t) - Date.now() / 1000)).toBeLessThan(300);
  });

  it('carries a freeze from proposal to Ready to the outbox, then marks it delivered', async () => {
    const reg = clients(k('REGULATOR_FISCO_KEY'));
    const account = privateKeyToAccount(generatePrivateKey()).address;
    const now = await reg.pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'chainTimeSeconds' });
    await sendFisco(reg.pub, reg.w, { address: d.agentStatus, abi: fiscoAbis.AgentStatus as never, functionName: 'openStatus', args: [account, 2, now + 3600n] });
    const id = await reg.pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'proposalCount' });
    const p = await reg.pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'proposal', args: [id] });
    const [msg] = decodeAbiParameters([{ type: 'tuple', components: types.StatusAttestation as never }], p.fields) as unknown as [{ account: Address; status: number; nonce: bigint; deadline: bigint; fiscoRef: Hex }];
    expect(msg.status).toBe(2);
    const h = digest(praetorDomain('Praetor-it', HOOK), 'StatusAttestation', msg);
    expect(await reg.pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'digestOf', args: [p.fields, 0] })).toBe(h);
    const sig = await privateKeyToAccount(k('REGULATOR_BASE_SIGNER_KEY')).sign({ hash: h });
    await sendFisco(reg.pub, reg.w, { address: d.agentStatus, abi: fiscoAbis.AgentStatus as never, functionName: 'sign', args: [id, sig] });
    expect(await reg.pub.readContract({ address: d.agentStatus, abi: fiscoAbis.AgentStatus, functionName: 'statusOf', args: [account] })).toBe(2);
    const [ids, msgs] = await reg.pub.readContract({ address: d.baseOutbox, abi: fiscoAbis.BaseOutbox, functionName: 'pending', args: [0n, 100n] });
    const mine = msgs.findIndex((m) => m.payload === p.fields);
    expect(mine).toBeGreaterThanOrEqual(0);
    const relayer = clients(k('RELAYER_FISCO_KEY'));
    await sendFisco(relayer.pub, relayer.w, { address: d.baseOutbox, abi: fiscoAbis.BaseOutbox as never, functionName: 'markDelivered', args: [ids[mine]!, keccak256(toHex('base tx')), 0] });
    const m = await relayer.pub.readContract({ address: d.baseOutbox, abi: fiscoAbis.BaseOutbox, functionName: 'message', args: [ids[mine]!] });
    expect(m.delivered).toBe(true);
  });

  it('reads more than ten blocks of events only through 10-block windows', async () => {
    const op = clients(k('OPERATOR_FISCO_KEY'));
    const from = await op.pub.getBlockNumber();
    for (let i = 0; i < 12; i++) {
      await sendFisco(op.pub, op.w, { address: d.auditLog, abi: fiscoAbis.AuditLog as never, functionName: 'append', args: [keccak256(toHex(`entry ${i}`)), 1, '0x0000000000000000000000000000000000000000', `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`] });
    }
    const to = await op.pub.getBlockNumber();
    expect(to - from).toBeGreaterThanOrEqual(11n);
    const event = fiscoAbis.AuditLog.find((x) => x.type === 'event' && x.name === 'AuditAppended')! as never;
    const chunked = await getLogsChunked(op.pub, { address: d.auditLog, event, fromBlock: from, toBlock: to });
    expect(chunked).toHaveLength(12);
    const plain = await op.pub.getLogs({ address: d.auditLog, event, fromBlock: from, toBlock: to }).catch(() => []);
    expect(plain.length).toBeLessThan(12);
  });
});
