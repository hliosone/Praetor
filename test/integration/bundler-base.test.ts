// M3 link: bundler -> EntryPoint -> Safe7579 account -> MandateHook on the Base Sepolia fork.
// Account creation through the launchpad (passkey, sponsored), agent payment, refusal logged with the hook's
// reason (I11), I1 (raw uninstall, unapproved self-call), I7 (agent module change), gas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { decodeEventLog, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MandateHookAbi, RefusalLogAbi, baseNow, type Deployment } from '@praetor/chain';
import { softPasskey, encodePasskeySignature, Reason, OwnerActionKind, merchantKey, merchantRef, type Policy } from '@praetor/protocol';
import { accountAbi, agentSignature, encodeExecute, fromJson, prepareAccount, type UserOp } from '@praetor/userop';
import { startBundler } from '@praetor/bundler';
import { ANVIL_URL, MYSQL_HOST, repoRoot, rpc } from './lib/stack.js';
import { deployFork, env, hookCall, localKey, members, mintUsdc, nextNonce, ownerActionCall, pad32, pub, setBalance, sign, usdcBalance } from './lib/praetor.js';

let d: Deployment;
let bundler: Awaited<ReturnType<typeof startBundler>>;
let base: string;
const passkey = softPasskey(`it-owner-${Date.now()}`);
const agentKey = keccak256(toHex(`it-agent-${Date.now()}`));
const agent = privateKeyToAccount(agentKey).address;
const landlord = privateKeyToAccount(keccak256(toHex(`it-landlord-${Date.now()}`))).address;
let account: Address;
const gas: Record<string, string> = {};

async function api(path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_BUNDLER}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function op(callData: Hex, validator: 'agent' | 'passkey', extra: Record<string, unknown> = {}) {
  const p = await api('/userop/prepare', { sender: account, callData, validator, ...extra });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const userOp = fromJson(p.body.userOp);
  const hash = p.body.userOpHash as Hex;
  const signature = validator === 'agent' ? await agentSignature(hash, agentKey) : encodePasskeySignature(passkey.credIdHash, passkey.sign(hash));
  return api('/userop/send', { userOp: { ...p.body.userOp, signature } as UserOp });
}

async function tx(to: Address, data: Hex) {
  const r = await api('/tx', { to, data });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.success).toBe(true);
}

beforeAll(async () => {
  d = await deployFork();
  await setBalance(privateKeyToAccount(localKey('BUNDLER_KEY')).address, 10n ** 19n);
  bundler = await startBundler({ ...env, CHAIN_MODE: 'fork', PRAETOR_ENV: 'local', BASE_RPC_URL: ANVIL_URL, DEPLOYMENTS_FILE: `${repoRoot}infra/deployments/fork-it.json`, MYSQL_HOST, PORT: '0', LOG_LEVEL: 'warn' });
  base = `http://127.0.0.1:${bundler.port}`;
}, 600_000);

afterAll(async () => bundler?.close());

describe('bundler -> Base (fork)', () => {
  it('reports healthy dependencies', async () => {
    const h = await fetch(`${base}/health`).then((r) => r.json());
    expect(h).toEqual({ ok: true, rpc: true, db: true });
  });

  it('creates the account through the launchpad with a passkey-signed, sponsored first op', async () => {
    const prep = await prepareAccount(pub, { ...d, credIdHash: passkey.credIdHash, x: passkey.x, y: passkey.y }, BigInt(Date.now()));
    account = prep.address;
    expect((await api('/accounts', { address: account })).status).toBe(204);
    const r = await op(prep.callData, 'passkey', { factory: prep.factory, factoryData: prep.factoryData });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.success).toBe(true);
    gas.firstOp = r.body.gasUsed;
    expect(await pub.readContract({ address: d.mandateHook, abi: MandateHookAbi, functionName: 'isInitialized', args: [account] })).toBe(true);
    expect(await pub.getBalance({ address: account })).toBe(0n);
  });

  it('sets Lin\'s mandate through member signatures and owner actions submitted by the bundler', async () => {
    const now = await baseNow(pub as never);
    const deadline = now + 3600n;
    const caps = { riskProfile: 2, perTxCap: 5_000_000_000n, dailyCap: 10_000_000_000n, monthlyCap: 50_000_000_000n, nonce: await nextNonce(d, 1, pad32('0x02')), deadline, fiscoRef: pad32('0x00') };
    await tx(d.mandateHook, hookCall('applyCaps', [caps, await sign(d, 'CapsAttestation', caps, [members.bank])]));
    const kya = { account, agentKey: agent, agentDidHash: keccak256(toHex('did')), kycCredentialHash: keccak256(toHex('kyc')), mandateCredentialHash: keccak256(toHex('mandate')),
      kycLevel: 2, riskProfile: 2, jurisdiction: '0x484b' as Hex, agentMeasurement: keccak256(toHex('rtmr3')), validUntil: now + 31_536_000n, nonce: await nextNonce(d, 2, pad32(account)), deadline, fiscoRef: pad32('0x00') };
    await tx(d.mandateHook, hookCall('applyKYA', [kya, await sign(d, 'KYAAttestation', kya, [members.bank])]));
    const hb = { epoch: await nextNonce(d, 7, pad32('0x00')), validUntil: now + 86_000n, deadline };
    await tx(d.mandateHook, hookCall('applyHeartbeat', [hb, await sign(d, 'HeartbeatAttestation', hb, [members.operator])]));
    const policy: Policy = {
      autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 1_000_000_000n,
      payees: [landlord], merchants: [merchantKey('0x00000000000000000000000000000000000000c1', merchantRef('KOWLOON-LETTINGS'))],
      bands: [{ token: d.usdc, minBps: 0, targetBps: 10_000, maxBps: 10_000 }],
      maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: now + 31_536_000n, soterEnabled: false,
    };
    await tx(d.mandateHook, await ownerActionCall(d, account, passkey, { kind: OwnerActionKind.SET_POLICY, account, policy }, true, now));
    await tx(d.mandateHook, await ownerActionCall(d, account, passkey, { kind: OwnerActionKind.SET_AGENT_KEY, account, agentKey: agent, validUntil: Number(now + 2_592_000n) }, true, now));
    await mintUsdc(d, account, 5_300_000_000n);
    expect(await usdcBalance(d, account)).toBe(5_300_000_000n);
  });

  it('lets the agent pay an allowlisted payee under the auto cap (T1)', async () => {
    const r = await op(encodeExecute([{ to: d.usdc, value: 0n, data: transfer(landlord, 150_000_000n) }]), 'agent');
    expect(r.body).toMatchObject({ success: true, reasons: [0], refusalLogTx: null });
    gas.agentPayment = r.body.gasUsed;
    expect(await usdcBalance(d, landlord)).toBe(150_000_000n);
    expect((await api(`/userop/${r.body.userOpHash}`)).body.success).toBe(true);
  });

  it('submits a refused op for evidence and logs the reason the hook computes (I11)', async () => {
    const stranger = privateKeyToAccount(keccak256(toHex(`it-stranger-${Date.now()}`))).address;
    const r = await op(encodeExecute([{ to: d.usdc, value: 0n, data: transfer(stranger, 150_000_000n) }]), 'agent');
    expect(r.body.success).toBe(false);
    expect(r.body.reasons).toEqual([Reason.UNKNOWN_PAYEE]);
    gas.refusedOp = r.body.gasUsed;
    const receipt = await pub.getTransactionReceipt({ hash: r.body.refusalLogTx });
    gas.refusalLog = receipt.gasUsed.toString();
    const ev = receipt.logs.map((l) => { try { return decodeEventLog({ abi: RefusalLogAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean);
    expect(ev?.eventName).toBe('Refused');
    expect((ev?.args as { reason: number }).reason).toBe(Reason.UNKNOWN_PAYEE);
    expect(await usdcBalance(d, stranger)).toBe(0n);
  });

  it('I1: the passkey cannot send raw uninstallModule (refused at validation, never submitted)', async () => {
    const raw = encodeFunctionData({ abi: accountAbi, functionName: 'uninstallModule', args: [4n, d.mandateHook, deinit()] });
    const r = await op(raw, 'passkey');
    expect(r.status).toBe(422);
    expect(r.body.detail).toContain('AA24');
  });

  it('I1: execute(self.uninstallModule) without a MODULE_CHANGE approval is refused by the hook', async () => {
    const self = encodeExecute([{ to: account, value: 0n, data: encodeFunctionData({ abi: accountAbi, functionName: 'uninstallModule', args: [4n, d.mandateHook, deinit()] }) }]);
    const r = await op(self, 'passkey');
    expect(r.body.success).toBe(false);
    expect(r.body.reasons).toEqual([Reason.HIDDEN_CALL]);
    expect(await pub.readContract({ address: account, abi: accountAbi, functionName: 'isModuleInstalled', args: [4n, d.mandateHook, hookCtx()] })).toBe(true);
  });

  it('I7: the agent key cannot change modules (refused at validation)', async () => {
    const self = encodeExecute([{ to: account, value: 0n, data: encodeFunctionData({ abi: accountAbi, functionName: 'uninstallModule', args: [4n, d.mandateHook, deinit()] }) }]);
    const r = await op(self, 'agent');
    expect(r.status).toBe(422);
    expect(r.body.detail).toContain('AA24');
  });

  it('a /tx the chain would refuse is answered success=false with its reason, and nothing is sent', async () => {
    const before = await rpc<string>(ANVIL_URL, 'eth_getTransactionCount', [privateKeyToAccount(localKey('BUNDLER_KEY')).address, 'latest']);
    // registerApproval with an empty auth: the hook reverts (as for a replayed SOTER counter, F6).
    const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'registerApproval', args: [{ account, callHash: `0x${'11'.repeat(32)}`, nonce: 1n, expiresAt: 1n }, { kind: 0, data: '0x' }] as never });
    const r = await api('/tx', { to: d.mandateHook, data });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: false, txHash: null });
    expect(typeof r.body.revert).toBe('string');
    expect(await rpc<string>(ANVIL_URL, 'eth_getTransactionCount', [privateKeyToAccount(localKey('BUNDLER_KEY')).address, 'latest'])).toBe(before);
  });

  it('records the gas of each step (snapshot in .run/gas-fork.json)', () => {
    writeFileSync(`${repoRoot}.run/gas-fork.json`, JSON.stringify(gas, null, 2));
    // Regression guards (actualGasUsed includes the 100k preVerificationGas); measured values go to docs.
    expect(Number(gas.agentPayment)).toBeLessThan(550_000);
    expect(Number(gas.refusedOp)).toBeLessThan(550_000);
  });
});

function transfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: parseAbi(['function transfer(address,uint256)']), functionName: 'transfer', args: [to, amount] });
}

function deinit(): Hex {
  return encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes4' }, { type: 'bytes' }], [0, '0x00000000', '0x']);
}

function hookCtx(): Hex {
  return encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes4' }], [0, '0x00000000']);
}
