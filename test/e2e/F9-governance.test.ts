// F9 (spec 06): consortium governance through the member services, delivered to Base by the bridge-relayer
// (BRIDGE=relayer). Steps 1, 2, 3 (FROZEN refusal on-chain), 5, 6, 7. The consoles (step 1 UI) arrive with M13.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi, baseNow } from '@praetor/chain';
import { Reason, callHash, digest, passkeyAuth, praetorDomain } from '@praetor/protocol';
import {
  agentOp, bootstrapConsortium, bundler, createAccount, fund, labelAddress, onboard, openAndSign, pub, setDemoPrices, stack, waitFor,
  type Account, type Stack,
} from '../../scripts/demo/lib.js';

let s: Stack;
let acc: Account;
const landlord = labelAddress('landlord');
const transfer = (to: Address, amount: bigint) => ({ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address, value: 0n, data: encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [to, amount] }) });
const read = <T>(fn: string, args: readonly unknown[]) => pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: fn as never, args: args as never }) as Promise<T>;
const effective = async () => (await read<readonly [number, number, number, bigint]>('statusOf', [acc.address]))[0];
const compose = (...args: string[]) => execFileSync('docker', ['compose', '-f', 'infra/compose.yml', '--env-file', 'infra/.env.example', '--env-file', '.env', '--env-file', '.run/compose.env', ...args], { cwd: new URL('../../', import.meta.url).pathname, stdio: 'pipe' });

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  acc = await createAccount(s, `f9-${Date.now()}`);
  await onboard(s, acc);
  await fund(s, acc, 2_000_000_000n, 0n, 0n);
}, 900_000);

describe('F9 consortium governance (BRIDGE=relayer)', () => {
  it('1-2: the regulator freezes the agent with one signature; Base applies it within 60 s', async () => {
    const t0 = Date.now();
    const p = await openAndSign(s, 'regulator', '/status', { account: acc.address, status: 2 }, ['regulator']);
    expect(p.ready).toBe(true);
    await waitFor('FROZEN on Base', async () => (await effective()) === 2, 60_000);
    expect(Date.now() - t0).toBeLessThan(60_000);
  });

  it('3: the next agent action is refused FROZEN on-chain (I14)', async () => {
    const r = await agentOp(s, acc, [transfer(landlord, 50_000_000n)]);
    expect(r.body.success).toBe(false);
    expect(r.body.reasons).toEqual([Reason.FROZEN]);
    expect(r.body.refusalLogTx).toMatch(/^0x/);
  });

  it('5: loosening to ACTIVE needs two members: one signature is not enough, two are', async () => {
    const p = await openAndSign(s, 'regulator', '/status', { account: acc.address, status: 0 }, ['regulator']);
    expect(p.ready).toBe(false);
    await new Promise((r) => setTimeout(r, 5000));
    expect(await effective()).toBe(2);
    const bankRead = await fetch(`${s.members.bank}/proposals/status/${p.proposalId}`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } }).then((r) => r.json());
    const { staffAssertion } = await import('../../scripts/demo/lib.js');
    const signed = await fetch(`${s.members.bank}/proposals/status/${p.proposalId}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` },
      body: JSON.stringify({ assertion: staffAssertion(s, 'bank', bankRead.digest) }),
    }).then((r) => r.json());
    expect(signed.ready).toBe(true);
    await waitFor('ACTIVE on Base', async () => (await effective()) === 0, 60_000);
    const r = await agentOp(s, acc, [transfer(landlord, 50_000_000n)]);
    expect(r.body.success).toBe(true);
  });

  it('6: without heartbeats autonomous actions become STALE_STATUS; human approvals still work (I4)', async () => {
    compose('stop', 'operator');
    try {
      const [,,, hb] = await read<readonly [number, number, number, bigint]>('statusOf', [acc.address]);
      const now = await baseNow(pub(s));
      await pub(s).request({ method: 'evm_increaseTime' as never, params: [Number(hb - now + 60n)] as never });
      await pub(s).request({ method: 'evm_mine' as never, params: [] as never });
      const call = transfer(landlord, 60_000_000n);
      const r = await agentOp(s, acc, [call]);
      expect(r.body.success).toBe(false);
      expect(r.body.reasons).toEqual([Reason.STALE_STATUS]);
      const t = await baseNow(pub(s));
      const a = { account: acc.address, callHash: callHash({ account: acc.address, target: call.to, value: 0n, data: call.data }), nonce: BigInt(keccak256(toHex(`${Date.now()}`))) % 2n ** 64n, expiresAt: t + 600n };
      const d = digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', a);
      const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'registerApproval', args: [a, passkeyAuth(acc.owner.credIdHash, acc.owner.sign(d))] });
      expect((await bundler(s, '/tx', { to: s.base.mandateHook, data })).body.success).toBe(true);
      const approved = await agentOp(s, acc, [call]);
      expect(approved.body.success).toBe(true);
    } finally {
      compose('start', 'operator');
    }
    await fetch(`${s.members.operator}/heartbeat/beat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` }, body: '{}' }).catch(() => undefined);
    await waitFor('fresh heartbeat on Base', async () => (await read<readonly [number, number, number, bigint]>('statusOf', [acc.address]))[3] > (await baseNow(pub(s))), 120_000);
  });

  it('7a: sanctions: one member lists, two delist', async () => {
    const target = labelAddress(`sanctioned-${Date.now()}`);
    expect((await openAndSign(s, 'regulator', '/sanctions', { target, listed: true }, ['regulator'])).ready).toBe(true);
    await waitFor('listed on Base', async () => read<boolean>('isSanctioned', [target]));
    const delist = await openAndSign(s, 'regulator', '/sanctions', { target, listed: false }, ['regulator']);
    expect(delist.ready).toBe(false);
    const { staffAssertion } = await import('../../scripts/demo/lib.js');
    const p = await fetch(`${s.members.bank}/proposals/sanctions/${delist.proposalId}`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } }).then((r) => r.json());
    const r = await fetch(`${s.members.bank}/proposals/sanctions/${delist.proposalId}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` },
      body: JSON.stringify({ assertion: staffAssertion(s, 'bank', p.digest as Hex) }),
    }).then((x) => x.json());
    expect(r.ready).toBe(true);
    await waitFor('delisted on Base', async () => !(await read<boolean>('isSanctioned', [target])));
  });

  it('7b: jurisdictions: block with one member, unblock with two', async () => {
    expect((await openAndSign(s, 'regulator', '/jurisdictions', { jurisdiction: 'US', blocked: true }, ['regulator'])).ready).toBe(true);
    await waitFor('US blocked on Base', async () => read<boolean>('isPayoutBlocked', ['0x5553']));
    expect((await openAndSign(s, 'regulator', '/jurisdictions', { jurisdiction: 'US', blocked: false }, ['regulator', 'operator'])).ready).toBe(true);
    await waitFor('US unblocked on Base', async () => !(await read<boolean>('isPayoutBlocked', ['0x5553'])));
  });

  it('7c: assets: any member suspends, the bank re-activates', async () => {
    expect((await openAndSign(s, 'operator', '/assets', { asset: s.base.txag, kind: 0, status: 2, maxWeightBps: 1500 }, ['operator'])).ready).toBe(true);
    await waitFor('tXAG suspended on Base', async () => (await read<readonly [number, number, number, bigint]>('assetOf', [s.base.txag]))[1] === 2);
    const act = await openAndSign(s, 'operator', '/assets', { asset: s.base.txag, kind: 0, status: 1, maxWeightBps: 1500 }, ['operator', 'regulator']);
    expect(act.ready).toBe(false);
    const { staffAssertion } = await import('../../scripts/demo/lib.js');
    const p = await fetch(`${s.members.bank}/proposals/assets/${act.proposalId}`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` } }).then((r) => r.json());
    const r = await fetch(`${s.members.bank}/proposals/assets/${act.proposalId}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.env.INTERNAL_TOKEN_MEMBERS}` },
      body: JSON.stringify({ assertion: staffAssertion(s, 'bank', p.digest as Hex) }),
    }).then((x) => x.json());
    expect(r.ready).toBe(true);
    await waitFor('tXAG active on Base', async () => (await read<readonly [number, number, number, bigint]>('assetOf', [s.base.txag]))[1] === 1);
  });

  it('7d: caps per profile (bank) and attesters (bank activates, any member deactivates)', async () => {
    await openAndSign(s, 'bank', '/caps', { riskProfile: 3, perTxCap: '12000000000', dailyCap: '20000000000', monthlyCap: '100000000000' }, ['bank']);
    await waitFor('growth caps on Base', async () => (await read<readonly [bigint, bigint, bigint]>('capsOf', [3]))[0] === 12_000_000_000n);
    const attester = labelAddress(`attester-${Date.now()}`);
    await openAndSign(s, 'bank', '/attesters', { attester, measurement: keccak256(toHex('rtmr3')), active: true }, ['bank']);
    await waitFor('attester active', async () => (await read<readonly [Hex, boolean]>('attesterOf', [attester]))[1]);
    await openAndSign(s, 'operator', '/attesters', { attester, measurement: keccak256(toHex('rtmr3')), active: false }, ['operator']);
    await waitFor('attester inactive', async () => !(await read<readonly [Hex, boolean]>('attesterOf', [attester]))[1]);
  });
});
