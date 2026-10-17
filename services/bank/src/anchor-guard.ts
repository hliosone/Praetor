// The bank as the second member of an anchor (spec 06 F8 step 2): before signing AnchorAttestation(seq, head, ...),
// it recomputes the audit chain from the operator's JSON entries and signs only a head that recomputation reaches.
// The FISCO AuditLog already fixes the head; this checks that the entries behind it exist and are intact.
import type { Hex } from 'viem';
import { ZERO_HASH, auditEntryHash, nextHead, type AuditEntry } from '@praetor/protocol';

export class AnchorRefused extends Error {
  status = 409;
}

/** The audit seq whose head is the anchored one; throws AnchorRefused otherwise. */
export async function checkAnchor(a: { seq: bigint; head: Hex; fiscoBlock: bigint; deadline: bigint }, entries: () => Promise<(AuditEntry & { head?: Hex })[]>): Promise<number> {
  let head: Hex = ZERO_HASH;
  for (const e of await entries()) {
    const { entryHash, head: _stored, ...json } = e;
    if (json.prevHead !== head || auditEntryHash(json) !== entryHash) throw new AnchorRefused(`audit entry ${e.seq} does not recompute`);
    head = nextHead(head, entryHash);
    if (head === a.head) return e.seq;
  }
  throw new AnchorRefused('the anchored head is not reached by the audit entries');
}
