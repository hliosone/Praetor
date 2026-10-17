import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { AUDIT_KINDS, Reason, Tier, ZERO_HASH, auditEntryHash, buildAuditChain, nextHead } from '@praetor/protocol';
import { AuditWriter, MemoryAuditStore, fromBaseLog, fromOutbox, type AuditChain, type SourceEvent } from '../src/audit.js';

const ACC = '0x00000000000000000000000000000000000c0ffe' as Address;
const TX = (n: number) => keccak256(toHex(`tx-${n}`));
const AT = 1_800_000_000_000;

describe('audit entries from Base events (spec 02 kinds)', () => {
  it('an allowed agent action is a DECISION with its tier, call hash and USD value', () => {
    const e = fromBaseLog({ eventName: 'Decision', args: { account: ACC, callHash: TX(9), reason: Reason.OK, tier: Tier.T1_AUTONOMOUS, target: ACC, valueUsd6: 12_500_000n }, transactionHash: TX(1), logIndex: 3 }, AT);
    expect(e).toMatchObject({ kind: 'DECISION', account: ACC, reason: 'OK', tier: 'T1_AUTONOMOUS', callHash: TX(9), baseTx: TX(1), amountUsd6: '12500000', atMs: AT });
    expect(e!.key).toBe(`base:${TX(1)}:3`);
  });

  it('a refusal carries the userOpHash and the reason name', () => {
    const e = fromBaseLog({ eventName: 'Refused', args: { userOpHash: TX(5), account: ACC, callHash: TX(9), reason: Reason.FROZEN, tier: Tier.T4_CONSORTIUM, target: ACC, reporter: ACC }, transactionHash: TX(2), logIndex: 0 }, AT);
    expect(e).toMatchObject({ kind: 'REFUSAL', reason: 'FROZEN', tier: 'T4_CONSORTIUM', userOpHash: TX(5) });
  });

  it('payouts link the payout id, paymentRef, merchantRef and later the settlementRef', () => {
    const req = fromBaseLog({ eventName: 'PayoutRequested', args: { id: 4n, account: ACC, partner: ACC, amount: 1_200_000_000n, rail: 1, merchantRef: TX(7), paymentRef: TX(8) }, transactionHash: TX(3), logIndex: 1 }, AT);
    expect(req).toMatchObject({ kind: 'PAYOUT_REQUESTED', payoutId: '4', paymentRef: TX(8), merchantRef: TX(7), amountUsd6: '1200000000', reason: 'ALIPAY_PLUS' });
    const done = fromBaseLog({ eventName: 'PayoutSettled', args: { id: 4n, settlementRef: TX(6) }, transactionHash: TX(4), logIndex: 0 }, AT);
    expect(done).toMatchObject({ kind: 'PAYOUT_SETTLED', payoutId: '4', settlementRef: TX(6), reason: 'SETTLED' });
    expect(fromBaseLog({ eventName: 'PayoutFailed', args: { id: 4n, code: TX(6) }, transactionHash: TX(4), logIndex: 1 }, AT)).toMatchObject({ kind: 'PAYOUT_SETTLED', reason: 'FAILED' });
  });

  it('governance applied on Base, standing orders, swaps and anchors have their kinds; prices are not audited', () => {
    const k = (eventName: string, args: Record<string, unknown>) => fromBaseLog({ eventName, args, transactionHash: TX(1), logIndex: 0 }, AT)?.kind;
    expect(k('StatusApplied', { account: ACC, status: 2, nonce: 1n, fiscoRef: ZERO_HASH, signerCount: 1 })).toBe('STATUS');
    expect(k('HeartbeatApplied', { epoch: 3n, validUntil: 9n })).toBe('HEARTBEAT');
    expect(k('KYAApplied', { account: ACC, agentKey: ACC, kycLevel: 2, riskProfile: 2, jurisdiction: '0x484b', validUntil: 1n, fiscoRef: ZERO_HASH })).toBe('KYA');
    expect(k('OwnerActionApplied', { account: ACC, action: 5, payloadHash: ZERO_HASH, authKind: 0, digest: ZERO_HASH })).toBe('OWNER_ACTION');
    expect(k('StandingOrderExecuted', { account: ACC, id: 1, amount: 5n, periodIndex: 0n, trigger: ACC })).toBe('STANDING_ORDER');
    expect(k('Swapped', { account: ACC, tokenIn: ACC, tokenOut: ACC, amountIn: 1n, amountOut: 1n, price8: 1n })).toBe('REBALANCE');
    expect(k('Anchored', { seq: 2n, head: TX(1), fiscoBlock: 7n })).toBe('ANCHOR');
    expect(k('AttesterApplied', { attester: ACC, measurement: ZERO_HASH, active: true })).toBe('KEY_ROTATION');
    expect(k('PriceUpdated', { token: ACC, price8: 1n, publishTime: 1n, source: 0 })).toBeUndefined();
  });

  it('a FISCO decision (BaseOutbox Enqueued) is audited with its FISCO transaction', () => {
    const e = fromOutbox({ id: 12n, kind: 0, board: ACC, proposalId: 30n }, TX(5), 4, AT);
    expect(e).toMatchObject({ kind: 'STATUS', reason: 'READY', fiscoTx: TX(5), key: `fisco:${TX(5)}:4` });
    expect(fromOutbox({ id: 13n, kind: 8, board: ACC, proposalId: 31n }, TX(6), 0, AT)!.kind).toBe('ANCHOR');
  });
});

/** FISCO AuditLog stand-in: the same chain rule as the contract. */
function fakeChain() {
  const heads: Hex[] = [ZERO_HASH];
  const appended: { entryHash: Hex; kind: number; account: Address }[] = [];
  let failNext = false;
  const chain: AuditChain = {
    latest: async () => ({ seq: BigInt(heads.length - 1), head: heads.at(-1)! }),
    headAt: async (seq) => heads[Number(seq)] ?? ZERO_HASH,
    append: async (entryHash, kind, account) => {
      if (failNext) { failNext = false; throw new Error('fisco down'); }
      appended.push({ entryHash, kind, account });
      heads.push(nextHead(heads.at(-1)!, entryHash));
      return TX(100 + heads.length);
    },
  };
  return { chain, heads, appended, failOnce: () => { failNext = true; } };
}
const ev = (n: number): SourceEvent => ({ key: `base:${TX(n)}:0`, account: ACC, kind: 'DECISION', reason: 'OK', baseTx: TX(n), atMs: AT + n, refId: TX(n) });

describe('audit writer', () => {
  it('stores each entry, appends its hash on FISCO, and the chain matches the protocol vectors', async () => {
    const { chain, appended, heads } = fakeChain();
    const store = new MemoryAuditStore();
    const w = new AuditWriter(store, chain);
    await w.record([ev(1), ev(2)]);
    const rows = await store.list(1, 10);
    expect(rows.map((r) => [r.entry.seq, r.state])).toEqual([[1, 'appended'], [2, 'appended']]);
    const expected = buildAuditChain(rows.map(({ entry }) => { const { prevHead: _p, entryHash: _e, ...input } = entry; return input; }));
    expect(rows.map((r) => r.entry.entryHash)).toEqual(expected.map((x) => x.entryHash));
    expect(heads.at(-1)).toBe(expected.at(-1)!.head);
    expect(appended[0]!.kind).toBe(AUDIT_KINDS.indexOf('DECISION'));
    expect(auditEntryHash(rows[0]!.entry)).toBe(rows[0]!.entry.entryHash);
  });

  it('never records the same event twice', async () => {
    const { chain, appended } = fakeChain();
    const w = new AuditWriter(new MemoryAuditStore(), chain);
    await w.record([ev(1)]);
    await w.record([ev(1), ev(2)]);
    expect(appended).toHaveLength(2);
  });

  it('a failed append stays pending and is appended on recovery, in order', async () => {
    const f = fakeChain();
    const store = new MemoryAuditStore();
    const w = new AuditWriter(store, f.chain);
    f.failOnce();
    await expect(w.record([ev(1), ev(2)])).rejects.toThrow(/fisco down/);
    expect((await store.list(1, 10)).map((r) => r.state)).toEqual(['pending']);
    await w.recover();
    await w.record([ev(1), ev(2)]);
    expect((await store.list(1, 10)).map((r) => [r.entry.seq, r.state])).toEqual([[1, 'appended'], [2, 'appended']]);
    expect(f.appended).toHaveLength(2);
  });

  it('recovery marks an entry appended when FISCO already has it (crash after the append)', async () => {
    const f = fakeChain();
    const store = new MemoryAuditStore();
    const w = new AuditWriter(store, f.chain);
    await w.record([ev(1)]);
    const [row] = await store.list(1, 1);
    await store.setState(row!.entry.seq, 'pending');
    await w.recover();
    expect((await store.list(1, 1))[0]!.state).toBe('appended');
    expect(f.appended).toHaveLength(1);
  });
});

describe('audit store bound to its AuditLog', () => {
  it('starts over when the FISCO AuditLog is a new one (consortium redeployed), keeps its entries otherwise', async () => {
    const store = new MemoryAuditStore();
    await store.bindTo('0x00000000000000000000000000000000000000a1');
    await new AuditWriter(store, fakeChain().chain).record([ev(1)]);
    await store.bindTo('0x00000000000000000000000000000000000000a1');
    expect(await store.list(1, 10)).toHaveLength(1);
    await store.bindTo('0x00000000000000000000000000000000000000b2');
    expect(await store.list(1, 10)).toHaveLength(0);
  });

  it('entries kept before any binding belong to an unknown log: the first binding starts over', async () => {
    const store = new MemoryAuditStore();
    await new AuditWriter(store, fakeChain().chain).record([ev(1)]);
    await store.bindTo('0x00000000000000000000000000000000000000a1');
    expect(await store.list(1, 10)).toHaveLength(0);
  });
});

describe('audit store checked against FISCO', () => {
  it('appended entries FISCO does not have (another AuditLog) are dropped before recording', async () => {
    const store = new MemoryAuditStore();
    await new AuditWriter(store, fakeChain().chain).record([ev(1), ev(2)]);
    const fresh = fakeChain();
    const w = new AuditWriter(store, fresh.chain);
    await w.reconcile();
    expect(await store.list(1, 10)).toHaveLength(0);
    await w.record([ev(3)]);
    expect((await store.list(1, 10)).map((r) => r.entry.seq)).toEqual([1]);
  });

  it('entries FISCO has are kept', async () => {
    const store = new MemoryAuditStore();
    const f = fakeChain();
    const w = new AuditWriter(store, f.chain);
    await w.record([ev(1), ev(2)]);
    await w.reconcile();
    expect(await store.list(1, 10)).toHaveLength(2);
  });
});
