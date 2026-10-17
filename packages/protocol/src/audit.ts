// Audit entries (off-chain JSON hashed into FISCO AuditLog) and the hash chain (spec 02).
import { encodeAbiParameters, keccak256, toHex, type Hex } from 'viem';
import { ZERO_HASH } from './constants.js';

export const AUDIT_KINDS = [
  'DECISION', 'REFUSAL', 'APPROVAL', 'OWNER_ACTION', 'STATUS', 'HEARTBEAT', 'KYA', 'ASSET', 'SANCTIONS', 'JURISDICTION',
  'CAPS', 'STANDING_ORDER', 'PAYOUT_REQUESTED', 'PAYOUT_SETTLED', 'REBALANCE', 'ANCHOR', 'KEY_ROTATION', 'RECOVERY',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

// uint256 amounts are decimal strings and atMs a JSON number: RFC 8785 has no integers above 2^53 (Q12).
export type AuditEntryInput = {
  seq: number; account: string; kind: AuditKind; reason: string; tier?: string;
  callHash?: string; baseTx?: string; userOpHash?: string; fiscoTx?: string; payoutId?: string; paymentRef?: string;
  settlementRef?: string; merchantRef?: string; amountUsd6?: string; atMs: number;
};
export type AuditEntry = AuditEntryInput & { prevHead: Hex; entryHash: Hex };

// RFC 8785 for the values our entries hold: objects, arrays, strings, safe numbers, booleans, null.
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('non-finite number');
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) throw new Error('integer above 2^53: use a decimal string');
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    for (const [key, val] of entries) if (val === undefined) throw new Error(`undefined value for ${key}`);
    // Default sort compares UTF-16 code units, which is what RFC 8785 requires.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`).join(',')}}`;
  }
  throw new Error(`cannot canonicalise ${typeof v}`);
}

const HEX_FIELDS = ['account', 'callHash', 'baseTx', 'userOpHash', 'fiscoTx', 'paymentRef', 'settlementRef', 'merchantRef', 'prevHead'] as const;

function normalise(e: AuditEntryInput & { prevHead: Hex }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(e)) if (val !== undefined && key !== 'entryHash' && key !== 'head') out[key] = val;
  for (const f of HEX_FIELDS) if (typeof out[f] === 'string') out[f] = (out[f] as string).toLowerCase();
  return out;
}

export const auditEntryHash = (e: AuditEntryInput & { prevHead: Hex }): Hex => keccak256(toHex(canonicalJson(normalise(e))));

export const nextHead = (prev: Hex, entryHash: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [prev, entryHash]));

export function buildAuditChain(inputs: AuditEntryInput[], start: Hex = ZERO_HASH): (AuditEntry & { head: Hex })[] {
  let head = start;
  return inputs.map((input) => {
    const withPrev = { ...input, prevHead: head };
    const entryHash = auditEntryHash(withPrev);
    head = nextHead(head, entryHash);
    return { ...withPrev, entryHash, head };
  });
}
