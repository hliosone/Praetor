import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { anchorDue, anchorOnce } from '../src/anchor.js';

describe('anchor proposer (spec 06 F8 step 2)', () => {
  const policy = { every: 20, intervalMs: 3_600_000 };

  it('anchors every 20 new entries, or hourly when anything is new, never with nothing new', () => {
    expect(anchorDue({ auditSeq: 40, anchoredSeq: 20, lastAnchorAt: 0, now: 1000, ...policy })).toBe(true);
    expect(anchorDue({ auditSeq: 39, anchoredSeq: 20, lastAnchorAt: 0, now: 1000, ...policy })).toBe(false);
    expect(anchorDue({ auditSeq: 21, anchoredSeq: 20, lastAnchorAt: 0, now: 3_600_000, ...policy })).toBe(true);
    expect(anchorDue({ auditSeq: 20, anchoredSeq: 20, lastAnchorAt: 0, now: 9_999_999, ...policy })).toBe(false);
  });

  it('opens the anchor on the audit board, signs it, then asks the bank to co-sign (two members)', async () => {
    const calls: unknown[] = [];
    const consortium = {
      deadline: async () => 99n,
      open: async (board: string, fn: string, args: readonly unknown[]) => { calls.push(['open', board, fn, args]); return { proposalId: 7n, digest: keccak256(toHex('d')) as Hex, txHash: keccak256(toHex('t')) as Hex }; },
      sign: async (board: string, id: bigint) => { calls.push(['sign', board, id]); return { txHash: keccak256(toHex('s')) as Hex, ready: false }; },
    };
    const r = await anchorOnce(consortium as never, async (id) => { calls.push(['cosign', id]); return { ready: true }; });
    expect(r).toEqual({ proposalId: 7n, ready: true });
    expect(calls).toEqual([['open', 'audit', 'openAnchor', [99n]], ['sign', 'audit', 7n], ['cosign', 7n]]);
  });
});
