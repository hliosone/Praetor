import { describe, it, expect } from 'vitest';
import type { Address, Hex } from 'viem';
import { ZERO_HASH, buildAuditChain, type AuditEntryInput } from '@praetor/protocol';
import { Audit, type AuditRow } from '../src/audit.js';

const A = '0x00000000000000000000000000000000000c0ffe' as Address;
const B = '0x0000000000000000000000000000000000000b0b' as Address;
const inputs: AuditEntryInput[] = Array.from({ length: 30 }, (_, i) => ({
  seq: i + 1, account: i % 3 === 0 ? B : A, kind: 'DECISION', reason: 'OK', amountUsd6: String(1_000_000 * (i + 1)), atMs: 1_800_000_000_000 + i * 1000,
}));
const chain = buildAuditChain(inputs);

function setup(o: { rows?: AuditRow[]; fiscoSeq?: number; anchorAt?: number; anchorHead?: Hex } = {}) {
  const rows = o.rows ?? chain.map((e) => ({ ...e }));
  const fiscoSeq = o.fiscoSeq ?? 30;
  const anchorAt = o.anchorAt ?? 20;
  const reads: number[] = [];
  const audit = new Audit({
    entries: async (from, limit) => rows.filter((r) => r.seq >= from).slice(0, limit),
    fisco: {
      latest: async () => ({ seq: BigInt(fiscoSeq), head: chain[fiscoSeq - 1]!.head }),
      headAt: async (seq) => { reads.push(Number(seq)); return seq === 0n ? ZERO_HASH : chain[Number(seq) - 1]!.head; },
    },
    anchor: { latest: async () => ({ seq: anchorAt ? 2n : 0n, head: o.anchorHead ?? (anchorAt ? chain[anchorAt - 1]!.head : ZERO_HASH), fiscoBlock: 77n }) },
  });
  return { audit, reads };
}

describe('audit verification (spec 06 F8 step 4)', () => {
  it('recomputes the chain from the JSON entries: it matches the FISCO head and the Base anchor', async () => {
    const v = await setup().audit.verify();
    expect(v).toMatchObject({ verified: true, entries: 30, head: chain[29]!.head, fisco: { seq: 30, match: true }, anchor: { seq: 2, auditSeq: 20, match: true } });
    expect(v.mismatchAt).toBeUndefined();
  });

  it('a tampered entry is found: Mismatch at #n', async () => {
    const rows = chain.map((e) => ({ ...e }));
    rows[11] = { ...rows[11]!, amountUsd6: '999' };
    const v = await setup({ rows }).audit.verify();
    expect(v).toMatchObject({ verified: false, mismatchAt: 12 });
  });

  it('a tampered entry whose stored hashes were rewritten too is still found, through the FISCO heads', async () => {
    const forged = buildAuditChain(inputs.map((e) => (e.seq === 7 ? { ...e, amountUsd6: '1' } : e)));
    const { audit, reads } = setup({ rows: forged.map((e) => ({ ...e })) });
    const v = await audit.verify();
    expect(v).toMatchObject({ verified: false, mismatchAt: 7 });
    expect(reads.length).toBeLessThan(10);
  });

  it('a missing entry breaks the chain at its place', async () => {
    const rows = chain.map((e) => ({ ...e })).filter((e) => e.seq !== 5);
    expect((await setup({ rows }).audit.verify())).toMatchObject({ verified: false, mismatchAt: 5 });
  });

  it('entries not yet on FISCO (pending) do not fail verification; an anchor of an unknown head does', async () => {
    expect((await setup({ fiscoSeq: 28 }).audit.verify())).toMatchObject({ verified: true, fisco: { seq: 28, match: true } });
    expect((await setup({ anchorHead: `0x${'ee'.repeat(32)}` }).audit.verify())).toMatchObject({ verified: false, anchor: { match: false, auditSeq: null } });
  });

  it("lists one account's entries in a time window", async () => {
    const l = await setup().audit.list(A, 1_800_000_003_000, 1_800_000_008_000);
    expect(l.map((e) => e.seq)).toEqual([5, 6, 8, 9]);
  });
});
