// Audit writer (spec 05 operator, spec 06 F8 step 1): every Base event of spec 02 and every FISCO decision (BaseOutbox
// Enqueued, emitted on each Ready) becomes an AuditEntry JSON kept here, whose hash the operator appends to the FISCO
// AuditLog. The entry is stored before its append and marked after, so a crash in between is resolved by reading the
// chain back (recover) and nothing is appended twice.
import { pad, toHex, type Address, type Hex } from 'viem';
import {
  AUDIT_KINDS, OWNER_ACTION_KINDS, REASONS, TIERS, ZERO_HASH, auditEntryHash, nextHead, Rail, type AuditEntry, type AuditEntryInput, type AuditKind,
} from '@praetor/protocol';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/** One event to audit: the entry fields (seq and prevHead come from the chain) plus its source key and FISCO refId. */
export type SourceEvent = Omit<AuditEntryInput, 'seq'> & { key: string; refId: Hex };
export type StoredRow = { entry: AuditEntry & { head: Hex }; state: 'pending' | 'appended'; key: string; refId: Hex };

export interface AuditStore {
  hasKey(key: string): Promise<boolean>;
  put(r: StoredRow): Promise<void>;
  setState(seq: number, state: StoredRow['state']): Promise<void>;
  pending(): Promise<StoredRow[]>;
  list(fromSeq: number, limit: number, account?: string): Promise<StoredRow[]>;
}

export class MemoryAuditStore implements AuditStore {
  rows: StoredRow[] = [];
  async hasKey(key: string) { return this.rows.some((r) => r.key === key); }
  async put(r: StoredRow) { this.rows.push(structuredClone(r)); }
  async setState(seq: number, state: StoredRow['state']) { const r = this.rows.find((x) => x.entry.seq === seq); if (r) r.state = state; }
  async pending() { return this.rows.filter((r) => r.state === 'pending').map((r) => structuredClone(r)); }
  async list(fromSeq: number, limit: number, account?: string) {
    return this.rows.filter((r) => r.entry.seq >= fromSeq && (!account || r.entry.account === account.toLowerCase())).sort((a, b) => a.entry.seq - b.entry.seq).slice(0, limit).map((r) => structuredClone(r));
  }
}

/** The FISCO AuditLog as the writer sees it. */
export interface AuditChain {
  latest(): Promise<{ seq: bigint; head: Hex }>;
  headAt(seq: bigint): Promise<Hex>;
  append(entryHash: Hex, kind: number, account: Address, baseTx: Hex, refId: Hex): Promise<Hex>;
}

export class AuditWriter {
  constructor(private readonly store: AuditStore, private readonly chain: AuditChain) {}

  /** Appends the events not seen before, in the order given. */
  async record(events: SourceEvent[]) {
    for (const ev of events) {
      if (await this.store.hasKey(ev.key)) continue;
      const { seq, head } = await this.chain.latest();
      const { key, refId, ...input } = ev;
      const withPrev = { ...input, account: input.account.toLowerCase(), seq: Number(seq) + 1, prevHead: head };
      const entryHash = auditEntryHash(withPrev);
      const row: StoredRow = { entry: { ...withPrev, entryHash, head: nextHead(head, entryHash) }, state: 'pending', key, refId };
      await this.store.put(row);
      await this.append(row);
    }
  }

  /** Resolves entries left pending by a crash or a failed append: already on FISCO, or appended now. */
  async recover() {
    for (const r of (await this.store.pending()).sort((a, b) => a.entry.seq - b.entry.seq)) {
      if ((await this.chain.headAt(BigInt(r.entry.seq))) === r.entry.head) {
        await this.store.setState(r.entry.seq, 'appended');
        continue;
      }
      const { seq, head } = await this.chain.latest();
      if (Number(seq) !== r.entry.seq - 1 || head !== r.entry.prevHead) throw new Error(`audit entry ${r.entry.seq} does not follow the FISCO head (${seq})`);
      await this.append(r);
    }
  }

  private async append(r: StoredRow) {
    const e = r.entry;
    await this.chain.append(e.entryHash, AUDIT_KINDS.indexOf(e.kind), e.account as Address, (e.baseTx ?? ZERO_HASH) as Hex, r.refId);
    await this.store.setState(e.seq, 'appended');
  }
}

type Log = { eventName: string; args: Record<string, any>; transactionHash: Hex; logIndex: number };

const STATUS = ['ACTIVE', 'RESTRICTED', 'FROZEN'];
const ASSET_STATUS = ['NONE', 'ACTIVE', 'SUSPENDED', 'DELISTED'];
const RAILS = Object.keys(Rail);
const id32 = (n: bigint | number) => pad(toHex(n), { size: 32 });
const jurisdiction = (b: Hex) => Buffer.from(b.slice(2), 'hex').toString('latin1');

/** The audit entry of one Base event, or undefined for events that are not audited (prices). */
export function fromBaseLog(l: Log, atMs: number): SourceEvent | undefined {
  const a = l.args;
  const base = { key: `base:${l.transactionHash}:${l.logIndex}`, baseTx: l.transactionHash, atMs, account: ZERO_ADDRESS as string, refId: ZERO_HASH as Hex };
  const e = (kind: AuditKind, reason: string, extra: Partial<SourceEvent> = {}): SourceEvent => ({ ...base, kind, reason, ...extra });
  switch (l.eventName) {
    case 'Decision':
      return e('DECISION', REASONS[a.reason] ?? `REASON_${a.reason}`, { account: a.account, tier: TIERS[a.tier], callHash: a.callHash, amountUsd6: String(a.valueUsd6), refId: a.callHash });
    case 'Refused':
      return e('REFUSAL', REASONS[a.reason] ?? `REASON_${a.reason}`, { account: a.account, tier: TIERS[a.tier], callHash: a.callHash, userOpHash: a.userOpHash, refId: a.callHash });
    case 'StatusApplied':
      return e('STATUS', STATUS[a.status] ?? `STATUS_${a.status}`, { account: a.account === ZERO_ADDRESS ? ZERO_ADDRESS : a.account, refId: a.fiscoRef });
    case 'HeartbeatApplied':
      return e('HEARTBEAT', 'APPLIED', { refId: id32(a.epoch) });
    case 'CapsApplied':
      return e('CAPS', `PROFILE_${a.riskProfile}`, { refId: a.fiscoRef });
    case 'KYAApplied':
      return e('KYA', 'APPLIED', { account: a.account, refId: a.fiscoRef });
    case 'AssetApplied':
      return e('ASSET', ASSET_STATUS[a.status] ?? `STATUS_${a.status}`, { account: a.asset, refId: a.fiscoRef });
    case 'SanctionsApplied':
      return e('SANCTIONS', a.listed ? 'LISTED' : 'DELISTED', { account: a.target, refId: a.fiscoRef });
    case 'JurisdictionApplied':
      return e('JURISDICTION', `${a.payoutBlocked ? 'BLOCKED' : 'UNBLOCKED'}_${jurisdiction(a.jurisdiction)}`, { refId: a.fiscoRef });
    case 'AttesterApplied':
      return e('KEY_ROTATION', a.active ? 'ATTESTER_ACTIVATED' : 'ATTESTER_DEACTIVATED', { account: a.attester, refId: a.measurement });
    case 'ApprovalRegistered':
      return e('APPROVAL', 'REGISTERED', { account: a.account, callHash: a.callHash, refId: a.callHash });
    case 'ApprovalConsumed':
      return e('APPROVAL', 'CONSUMED', { account: a.account, callHash: a.callHash, refId: a.callHash });
    case 'OwnerActionApplied':
      return e('OWNER_ACTION', OWNER_ACTION_KINDS[a.action] ?? `ACTION_${a.action}`, { account: a.account, refId: a.payloadHash });
    case 'PolicySet':
      return e('OWNER_ACTION', 'POLICY_SET', { account: a.account, refId: a.policyHash });
    case 'RecoveryScheduled':
    case 'RecoveryCancelled':
    case 'RecoveryExecuted':
      return e('RECOVERY', l.eventName.slice('Recovery'.length).toUpperCase(), { account: a.account, refId: a.payloadHash });
    case 'StandingOrderSet':
      return e('STANDING_ORDER', 'SET', { account: a.account, refId: a.orderHash });
    case 'StandingOrderCancelled':
      return e('STANDING_ORDER', 'CANCELLED', { account: a.account, refId: id32(a.id) });
    case 'StandingOrderExecuted':
      return e('STANDING_ORDER', 'EXECUTED', { account: a.account, amountUsd6: String(a.amount), refId: id32(a.id) });
    case 'PayoutRequested':
      return e('PAYOUT_REQUESTED', RAILS[a.rail] ?? `RAIL_${a.rail}`, { account: a.account, payoutId: String(a.id), paymentRef: a.paymentRef, merchantRef: a.merchantRef, amountUsd6: String(a.amount), refId: a.paymentRef });
    case 'PayoutSettled':
      return e('PAYOUT_SETTLED', 'SETTLED', { account: a.account ?? ZERO_ADDRESS, payoutId: String(a.id), settlementRef: a.settlementRef, refId: id32(a.id) });
    case 'PayoutFailed':
      return e('PAYOUT_SETTLED', 'FAILED', { account: a.account ?? ZERO_ADDRESS, payoutId: String(a.id), refId: id32(a.id) });
    case 'Swapped':
      return e('REBALANCE', 'SWAPPED', { account: a.account });
    case 'Anchored':
      return e('ANCHOR', `SEQ_${a.seq}`, { refId: a.head });
    default:
      return undefined;
  }
}

// FISCO message kinds (Board.sol): an attester decision is a key rotation in the audit vocabulary.
const OUTBOX_KINDS: AuditKind[] = ['STATUS', 'HEARTBEAT', 'CAPS', 'KYA', 'ASSET', 'SANCTIONS', 'JURISDICTION', 'KEY_ROTATION', 'ANCHOR'];

/** A FISCO decision: BaseOutbox Enqueued, emitted when a board proposal is Ready. */
export function fromOutbox(a: { id: bigint; kind: number; board: Address; proposalId: bigint }, fiscoTx: Hex, logIndex: number, atMs: number): SourceEvent | undefined {
  const kind = OUTBOX_KINDS[a.kind];
  if (!kind) return undefined;
  return { key: `fisco:${fiscoTx}:${logIndex}`, kind, reason: 'READY', account: ZERO_ADDRESS, fiscoTx, atMs, refId: id32(a.id) };
}
