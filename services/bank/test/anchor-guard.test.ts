import { describe, it, expect } from 'vitest';
import type { Hex } from 'viem';
import { buildAuditChain, type AuditEntryInput } from '@praetor/protocol';
import { AnchorRefused, checkAnchor } from '../src/anchor-guard.js';

const inputs: AuditEntryInput[] = Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, account: '0x00000000000000000000000000000000000c0ffe', kind: 'DECISION', reason: 'OK', atMs: 1_800_000_000_000 + i }));
const chain = buildAuditChain(inputs);
const entries = async () => chain.map((e) => ({ ...e }));

describe('bank co-signature of an anchor (second member, spec 06 F8 step 2)', () => {
  it('signs a head it recomputed from the JSON entries', async () => {
    expect(await checkAnchor({ seq: 1n, head: chain[3]!.head, fiscoBlock: 9n, deadline: 0n }, entries)).toBe(4);
  });

  it('refuses a head that no recomputation reaches, or entries whose JSON does not hash to their hash', async () => {
    await expect(checkAnchor({ seq: 1n, head: `0x${'ee'.repeat(32)}` as Hex, fiscoBlock: 9n, deadline: 0n }, entries)).rejects.toThrow(AnchorRefused);
    const tampered = async () => chain.map((e) => (e.seq === 2 ? { ...e, reason: 'FROZEN' } : { ...e }));
    await expect(checkAnchor({ seq: 1n, head: chain[3]!.head, fiscoBlock: 9n, deadline: 0n }, tampered)).rejects.toThrow(/entry 2/);
  });
});
