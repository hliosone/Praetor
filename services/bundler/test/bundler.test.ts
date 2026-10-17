import { describe, it, expect, beforeEach } from 'vitest';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { encodeExecute, nonceKey, type UserOp } from '@praetor/userop';
import { Bundler, NotSponsorable, RateLimited, ValidationFailed, NotAllowed, type Chain, type SubmitResult } from '../src/bundler.js';
import { MemoryStore } from '../src/store.js';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const ACCOUNT = A(0xa11c);
const PAYMASTER = A(0x9a9a);
const AGENT_VALIDATOR = A(0xa6);
const PASSKEY_VALIDATOR = A(0xbb);
const USDC = A(0xc0);

class FakeChain implements Chain {
  initialized = new Set<string>([ACCOUNT.toLowerCase()]);
  reasons: number[] = [0];
  validationError: string | null = null;
  success = true;
  submitted: UserOp[] = [];
  logged: { userOpHash: Hex; calls: number }[] = [];
  txs: { to: Address; data: Hex }[] = [];
  estimate: bigint | null = 100_000n;
  async getNonce(_s: Address, key: bigint) { return key << 64n; }
  async isInitialized(a: Address) { return this.initialized.has(a.toLowerCase()); }
  async estimateExecute() { if (this.estimate === null) throw new Error('reverts'); return this.estimate; }
  async fees() { return { maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }; }
  async now() { return 1_800_000_000n; }
  async checkBatch(_a: Address, calls: unknown[]) { return calls.map((_, i) => this.reasons[i] ?? 0); }
  async simulateHandleOps() { return this.validationError; }
  async submitHandleOps(op: UserOp, h: Hex): Promise<SubmitResult> { this.submitted.push(op); return { txHash: keccak256(toHex('tx')), success: this.success, userOpHash: h, gasUsed: 123n }; }
  async logRefusal(userOpHash: Hex, _a: Address, calls: unknown[]) { this.logged.push({ userOpHash, calls: calls.length }); return keccak256(toHex('log')); }
  async sendTx(to: Address, data: Hex) { this.txs.push({ to, data }); return { txHash: keccak256(toHex('plain')), success: true }; }
  async isOwnLaunchpadInit() { return false; }
}

const cfg = {
  paymaster: PAYMASTER, paymasterKey: keccak256(toHex('pm')), chainId: 84532, maxRefusedPerDay: 2, skipRefused: false,
  validators: { agent: AGENT_VALIDATOR, passkey: PASSKEY_VALIDATOR }, txTargets: [A(0x400c)],
};

let chain: FakeChain;
let store: MemoryStore;
let b: Bundler;
const pay = encodeExecute([{ to: USDC, value: 0n, data: '0xa9059cbb' }]);

beforeEach(async () => {
  chain = new FakeChain();
  store = new MemoryStore();
  b = new Bundler(chain, store, cfg);
  await b.register(ACCOUNT);
});

async function signed(validator: 'agent' | 'passkey' = 'agent', callData: Hex = pay): Promise<UserOp> {
  const { userOp } = await b.prepare({ sender: ACCOUNT, callData, validator });
  return { ...userOp, signature: '0x01' };
}

describe('prepare', () => {
  it('sets the validator nonce key, simulated gas x1.3 (min 300k) and a paymaster sponsorship', async () => {
    const { userOp, userOpHash } = await b.prepare({ sender: ACCOUNT, callData: pay, validator: 'agent' });
    expect(userOp.nonce).toBe(nonceKey(AGENT_VALIDATOR) << 64n);
    expect(userOp.callGasLimit).toBe(300_000n);
    expect(userOp.paymaster).toBe(PAYMASTER);
    expect(userOp.paymasterData?.length).toBe(2 + 2 * (12 + 65));
    expect(userOpHash).toMatch(/^0x[0-9a-f]{64}$/);
    chain.estimate = 1_000_000n;
    expect((await b.prepare({ sender: ACCOUNT, callData: pay, validator: 'passkey' })).userOp.callGasLimit).toBe(1_300_000n);
  });

  it('falls back to the minimum when the simulation reverts (a refused call is still submitted for evidence)', async () => {
    chain.estimate = null;
    expect((await b.prepare({ sender: ACCOUNT, callData: pay, validator: 'agent' })).userOp.callGasLimit).toBe(300_000n);
  });

  it('sponsors only registered and initialized accounts, or our own launchpad init', async () => {
    await expect(b.prepare({ sender: A(0xdead), callData: pay, validator: 'agent' })).rejects.toThrow(NotSponsorable);
    await b.register(A(0xbeef));
    await expect(b.prepare({ sender: A(0xbeef), callData: pay, validator: 'agent' })).rejects.toThrow(NotSponsorable);
    const seen: unknown[] = [];
    chain.isOwnLaunchpadInit = async (...args: unknown[]) => { seen.push(args); return true; };
    const r = await b.prepare({ sender: A(0xbeef), callData: '0xd9ed0e8f', validator: 'passkey', factory: A(1), factoryData: '0x01' });
    expect(seen[0]).toEqual([A(0xbeef), A(1), '0x01', '0xd9ed0e8f']);
    expect(r.userOp.factory).toBe(A(1));
    expect(r.userOp.verificationGasLimit).toBe(3_000_000n);
  });
});

describe('send', () => {
  it('simulates, submits and returns the outcome', async () => {
    const r = await b.send(await signed());
    expect(r.success).toBe(true);
    expect(r.reasons).toEqual([0]);
    expect(r.refusalLogTx).toBeNull();
    expect(chain.submitted).toHaveLength(1);
    expect((await b.getOp(r.userOpHash))?.success).toBe(true);
  });

  it('submits a refused op for on-chain evidence and logs the reason through RefusalLog', async () => {
    chain.reasons = [7];
    chain.success = false;
    const r = await b.send(await signed());
    expect(r.success).toBe(false);
    expect(r.reasons).toEqual([7]);
    expect(r.refusalLogTx).toMatch(/^0x/);
    expect(chain.logged).toEqual([{ userOpHash: r.userOpHash, calls: 1 }]);
  });

  it('rate-limits refused ops per account per day', async () => {
    chain.reasons = [7];
    chain.success = false;
    await b.send(await signed());
    await b.send(await signed());
    await expect(b.send(await signed())).rejects.toThrow(RateLimited);
    expect(chain.submitted).toHaveLength(2);
  });

  it('skipRefused keeps refused ops off-chain (sandbox spam guard)', async () => {
    chain.reasons = [7];
    const s = new Bundler(chain, store, { ...cfg, skipRefused: true });
    const r = await s.send(await signed());
    expect(r.skipped).toBe(true);
    expect(chain.submitted).toHaveLength(0);
  });

  it('never submits an op whose validation fails (Q20: a failed first op bricks the address)', async () => {
    chain.validationError = 'AA24 signature error';
    await expect(b.send(await signed())).rejects.toThrow(ValidationFailed);
    expect(chain.submitted).toHaveLength(0);
  });

  it('refuses ops it did not sponsor', async () => {
    const op = { ...(await signed()), paymaster: A(0x1234) };
    await expect(b.send(op)).rejects.toThrow(NotSponsorable);
  });
});

describe('plain transactions', () => {
  it('sends only to allowlisted contracts', async () => {
    expect((await b.tx(A(0x400c), '0x12')).success).toBe(true);
    await expect(b.tx(A(0x5555), '0x12')).rejects.toThrow(NotAllowed);
  });
});
