import { describe, it, expect, beforeEach } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { types } from '@praetor/protocol';
import { Relayer, type OutboxMessage, type OutboxPort, type BasePort, type WeCrossPort } from '../src/relayer.js';

const HOOK = '0x00000000000000000000000000000000000000h0'.replace('h', 'a') as Address;
const ANCHOR = '0x00000000000000000000000000000000000000b0' as Address;
const ZERO = `0x${'00'.repeat(32)}` as Hex;

function statusMsg(id: bigint, nonce: bigint, enqueuedAt = 1_000n): OutboxMessage {
  const a = { account: '0x00000000000000000000000000000000000000c1' as Address, status: 2, nonce, deadline: 9_999_999_999n, fiscoRef: ZERO };
  return { id, kind: 0, payload: encodeAbiParameters([{ type: 'tuple', components: types.StatusAttestation as never }], [a as never]), sigs: ['0x01'], enqueuedAt };
}

function anchorMsg(id: bigint): OutboxMessage {
  const a = { seq: 1n, head: keccak256(toHex('h')), fiscoBlock: 5n, deadline: 9_999_999_999n };
  return { id, kind: 8, payload: encodeAbiParameters([{ type: 'tuple', components: types.AnchorAttestation as never }], [a as never]), sigs: ['0x01', '0x02'], enqueuedAt: 1_000n };
}

class FakeOutbox implements OutboxPort {
  msgs: OutboxMessage[] = [];
  marked: { id: bigint; baseTx: Hex; transport: number }[] = [];
  async pending() { return this.msgs.filter((m) => !this.marked.some((x) => x.id === m.id)); }
  async markDelivered(id: bigint, baseTx: Hex, transport: number) { this.marked.push({ id, baseTx, transport }); return keccak256(toHex(`mark${id}`)); }
  clock = 2_000n;
  async now() { return this.clock; }
}

class FakeBase implements BasePort {
  sims: { to: Address; data: Hex }[] = [];
  sent: { to: Address; data: Hex }[] = [];
  error: string | null = null;
  applied = 0n;
  async simulate(to: Address, data: Hex) { this.sims.push({ to, data }); return this.error ? { ok: false as const, error: this.error } : { ok: true as const }; }
  async send(to: Address, data: Hex) { this.sent.push({ to, data }); return { txHash: keccak256(toHex(`tx${this.sent.length}`)), success: true }; }
  async appliedNonce() { return this.applied; }
}

class FakeWeCross implements WeCrossPort {
  asked: bigint[] = [];
  async requested(id: bigint) { return this.asked.includes(id); }
  async request(id: bigint) { this.asked.push(id); }
}

let outbox: FakeOutbox;
let base: FakeBase;
let wecross: FakeWeCross;
const relayer = (mode: 'relayer' | 'wecross' = 'relayer') => new Relayer(outbox, base, { hook: HOOK, anchor: ANCHOR, mode, watchdogS: 120n }, mode === 'wecross' ? wecross : undefined);

beforeEach(() => {
  outbox = new FakeOutbox();
  base = new FakeBase();
  wecross = new FakeWeCross();
});

describe('bridge-relayer (spec 05)', () => {
  it('delivers a Ready status to MandateHook.applyStatus, then marks it delivered on FISCO', async () => {
    outbox.msgs = [statusMsg(0n, 1n)];
    const r = await relayer().tick();
    expect(r).toEqual([{ id: 0n, outcome: 'delivered', txHash: expect.any(String) }]);
    expect(base.sent[0]!.to).toBe(HOOK);
    expect(decodeFunctionData({ abi: MandateHookAbi, data: base.sent[0]!.data }).functionName).toBe('applyStatus');
    expect(outbox.marked).toEqual([{ id: 0n, baseTx: r[0]!.txHash, transport: 0 }]);
  });

  it('routes anchors to the Anchor contract', async () => {
    outbox.msgs = [anchorMsg(3n)];
    await relayer().tick();
    expect(base.sent[0]!.to).toBe(ANCHOR);
  });

  it('marks a message already applied on Base (by WeCross or a member) without sending', async () => {
    outbox.msgs = [statusMsg(0n, 1n)];
    base.error = 'BadNonce';
    base.applied = 1n;
    expect((await relayer().tick())[0]!.outcome).toBe('already-applied');
    expect(base.sent).toHaveLength(0);
    expect(outbox.marked[0]!.baseTx).toBe(ZERO);
  });

  it('leaves a message whose earlier nonce is missing, and an expired one for reissue', async () => {
    outbox.msgs = [statusMsg(0n, 3n)];
    base.error = 'BadNonce';
    base.applied = 1n;
    expect((await relayer().tick())[0]!.outcome).toBe('blocked');
    base.error = 'Expired';
    expect((await relayer().tick())[0]!.outcome).toBe('expired');
    expect(outbox.marked).toHaveLength(0);
  });

  it('as a WeCross watchdog, waits BRIDGE_WATCHDOG_S before delivering', async () => {
    outbox.msgs = [statusMsg(0n, 1n, 1_950n)];
    wecross.asked = [0n];
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('waiting');
    outbox.clock = 2_100n;
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('delivered');
  });

  it('measures the watchdog on FISCO\'s clock, where the message was enqueued, whatever the Base clock says', async () => {
    // A fork moved forward (F10's 48 h) must not make every message look overdue and bypass WeCross.
    outbox.msgs = [statusMsg(0n, 1n, 1_990n)];
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('requested');
    expect(base.sent).toHaveLength(0);
  });

  it('with BRIDGE=wecross, asks WeCross once to deliver a new message (as the router account), then waits for it', async () => {
    outbox.msgs = [statusMsg(0n, 1n, 1_990n)];
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('requested');
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('waiting');
    expect(wecross.asked).toEqual([0n]);
    expect(base.sent).toHaveLength(0);
  });

  it('with BRIDGE=wecross, a message WeCross already applied is recorded as a WeCross delivery after the watchdog delay', async () => {
    outbox.msgs = [statusMsg(0n, 1n, 1_000n)];
    wecross.asked = [0n];
    base.error = 'BadNonce';
    base.applied = 1n;
    expect((await relayer('wecross').tick())[0]!.outcome).toBe('already-applied');
    expect(outbox.marked[0]!.transport).toBe(1);
  });

  it('retries a transient failure on the next tick', async () => {
    outbox.msgs = [statusMsg(0n, 1n)];
    base.error = 'rpc timeout';
    expect((await relayer().tick())[0]!.outcome).toBe('failed');
    base.error = null;
    expect((await relayer().tick())[0]!.outcome).toBe('delivered');
  });
});
