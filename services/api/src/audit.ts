// Audit (spec 06 F8 step 4): three independent sources. The JSON entries kept by the operator are recomputed here,
// entry by entry; the result must equal the FISCO AuditLog head (and its head at every seq), and the latest Base
// anchor must be one of the recomputed heads. A tampered entry shows as "Mismatch at #n", even when the stored hashes
// were rewritten with it (the FISCO heads locate it by bisection).
import type { Address, Hex } from 'viem';
import { ZERO_HASH, auditEntryHash, nextHead, type AuditEntry } from '@praetor/protocol';

export type AuditRow = AuditEntry & { head: Hex };

export type AuditDeps = {
  /** The operator's entries from `fromSeq`, in seq order (an account filter is a hint). */
  entries(fromSeq: number, limit: number, account?: Address): Promise<AuditRow[]>;
  fisco: { latest(): Promise<{ seq: bigint; head: Hex }>; headAt(seq: bigint): Promise<Hex> };
  anchor: { latest(): Promise<{ seq: bigint; head: Hex; fiscoBlock: bigint }> };
};

const PAGE = 500;

export class Audit {
  constructor(private readonly d: AuditDeps) {}

  private async all(account?: Address): Promise<AuditRow[]> {
    const out: AuditRow[] = [];
    for (let from = 1; ; ) {
      const page = await this.d.entries(from, PAGE, account);
      out.push(...page);
      if (page.length < PAGE) return out;
      from = page.at(-1)!.seq + 1;
    }
  }

  async list(account: Address, fromMs: number, toMs: number) {
    const a = account.toLowerCase();
    return (await this.all(account)).filter((e) => e.account.toLowerCase() === a && e.atMs >= fromMs && e.atMs <= toMs);
  }

  async verify() {
    // FISCO's head first: the operator stores each entry before appending it to FISCO, so the entries read next cover
    // that head even if the log grows meanwhile (reading FISCO second reported a race as a mismatch).
    const fisco = await this.d.fisco.latest();
    const rows = await this.all();
    // Recompute from the JSON alone: stored hashes and heads are not trusted.
    const heads: Hex[] = [ZERO_HASH];
    let mismatchAt: number | undefined;
    for (const [i, row] of rows.entries()) {
      const seq = i + 1;
      const { entryHash, head: _stored, ...json } = row;
      if (row.seq !== seq || row.prevHead !== heads[seq - 1]) { mismatchAt ??= seq; break; }
      const h = auditEntryHash(json);
      if (h !== entryHash) mismatchAt ??= seq;
      heads.push(nextHead(heads[seq - 1]!, h));
    }
    const recomputed = heads.length - 1;
    const upTo = Math.min(Number(fisco.seq), recomputed);
    const fiscoHeadAt = (k: number) => (k === Number(fisco.seq) ? Promise.resolve(fisco.head) : this.d.fisco.headAt(BigInt(k)));
    let fiscoMatch = Number(fisco.seq) <= recomputed && heads[upTo] === (await fiscoHeadAt(upTo));
    if (!fiscoMatch && upTo > 0) {
      // First k whose recomputed head differs from FISCO's (heads agree up to some point, then never again).
      let lo = 1, hi = upTo;
      if (heads[upTo] === (await fiscoHeadAt(upTo))) lo = upTo + 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (heads[mid] === (await fiscoHeadAt(mid))) lo = mid + 1;
        else hi = mid;
      }
      if (lo <= upTo) mismatchAt = Math.min(mismatchAt ?? lo, lo);
      else mismatchAt ??= recomputed + 1;
    }
    if (mismatchAt !== undefined) fiscoMatch = false;
    const a = await this.d.anchor.latest();
    const k = a.seq === 0n ? null : heads.indexOf(a.head);
    const auditSeq = k === null || k < 1 ? null : k;
    const anchorMatch = a.seq === 0n || auditSeq !== null;
    return {
      verified: mismatchAt === undefined && fiscoMatch && anchorMatch,
      entries: rows.length,
      head: heads[recomputed]!,
      ...(mismatchAt !== undefined ? { mismatchAt } : {}),
      fisco: { seq: Number(fisco.seq), head: fisco.head, match: fiscoMatch },
      anchor: { seq: Number(a.seq), head: a.head, fiscoBlock: Number(a.fiscoBlock), auditSeq, match: anchorMatch },
    };
  }
}
