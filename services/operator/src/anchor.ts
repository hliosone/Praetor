// Anchor proposer (spec 05 operator, spec 06 F8 steps 2-3): every `every` new audit entries, or every interval when
// anything is new, the operator opens an AnchorAttestation of the FISCO AuditLog head (the contract fills in seq, head
// and block, so nobody can anchor a head that is not on FISCO), signs it, and asks a second member to co-sign; the
// bridge then delivers it to Base.
import type { ConsortiumPort } from '@praetor/member-kit';

export function anchorDue(s: { auditSeq: number; anchoredSeq: number; lastAnchorAt: number; now: number; every: number; intervalMs: number }): boolean {
  if (s.auditSeq <= s.anchoredSeq) return false;
  return s.auditSeq - s.anchoredSeq >= s.every || s.now - s.lastAnchorAt >= s.intervalMs;
}

/** An anchor still open on the board (the board refuses a second one until it closes or expires). */
export type OpenAnchor = { id: bigint; signedByMe: boolean } | null;

export async function anchorOnce(c: Pick<ConsortiumPort, 'deadline' | 'open' | 'sign'>, cosign: (proposalId: bigint) => Promise<{ ready: boolean }>, openNow: () => Promise<OpenAnchor> = async () => null) {
  // A co-signature lost (the bank restarting, a timeout) must not block anchoring until the proposal expires: resume it.
  const open = await openNow();
  if (open) {
    if (!open.signedByMe) await c.sign('audit', open.id);
    return { proposalId: open.id, ready: (await cosign(open.id)).ready };
  }
  const { proposalId } = await c.open('audit', 'openAnchor', [await c.deadline()]);
  await c.sign('audit', proposalId);
  const { ready } = await cosign(proposalId);
  return { proposalId, ready };
}
