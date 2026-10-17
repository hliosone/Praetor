// EIP-712 struct types of spec 02 (exact field order: it is part of every hash).
import { hashStruct, hashTypedData, keccak256, toHex, type Address, type Hex, type TypedDataDomain } from 'viem';

export const types = {
  StatusAttestation: [
    { name: 'account', type: 'address' }, { name: 'status', type: 'uint8' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  HeartbeatAttestation: [
    { name: 'epoch', type: 'uint64' }, { name: 'validUntil', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
  ],
  CapsAttestation: [
    { name: 'riskProfile', type: 'uint8' }, { name: 'perTxCap', type: 'uint256' }, { name: 'dailyCap', type: 'uint256' },
    { name: 'monthlyCap', type: 'uint256' }, { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
    { name: 'fiscoRef', type: 'bytes32' },
  ],
  KYAAttestation: [
    { name: 'account', type: 'address' }, { name: 'agentKey', type: 'address' }, { name: 'agentDidHash', type: 'bytes32' },
    { name: 'kycCredentialHash', type: 'bytes32' }, { name: 'mandateCredentialHash', type: 'bytes32' },
    { name: 'kycLevel', type: 'uint8' }, { name: 'riskProfile', type: 'uint8' }, { name: 'jurisdiction', type: 'bytes2' },
    { name: 'agentMeasurement', type: 'bytes32' }, { name: 'validUntil', type: 'uint64' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  AssetAttestation: [
    { name: 'asset', type: 'address' }, { name: 'kind', type: 'uint8' }, { name: 'status', type: 'uint8' },
    { name: 'maxWeightBps', type: 'uint16' }, { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' },
    { name: 'fiscoRef', type: 'bytes32' },
  ],
  SanctionsAttestation: [
    { name: 'target', type: 'address' }, { name: 'listed', type: 'bool' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  JurisdictionAttestation: [
    { name: 'jurisdiction', type: 'bytes2' }, { name: 'payoutBlocked', type: 'bool' }, { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  AttesterAttestation: [
    { name: 'attester', type: 'address' }, { name: 'measurement', type: 'bytes32' }, { name: 'active', type: 'bool' },
    { name: 'nonce', type: 'uint64' }, { name: 'deadline', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  AnchorAttestation: [
    { name: 'seq', type: 'uint64' }, { name: 'head', type: 'bytes32' }, { name: 'fiscoBlock', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
  Tier2Approval: [
    { name: 'account', type: 'address' }, { name: 'callHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
  OwnerAction: [
    { name: 'account', type: 'address' }, { name: 'action', type: 'uint8' }, { name: 'payloadHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }, { name: 'fiscoRef', type: 'bytes32' },
  ],
  SoterApproval: [
    { name: 'account', type: 'address' }, { name: 'digest', type: 'bytes32' }, { name: 'bindingHash', type: 'bytes32' },
    { name: 'soterCounter', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
  ],
  StandingOrder: [
    { name: 'account', type: 'address' }, { name: 'id', type: 'uint32' }, { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' }, { name: 'period', type: 'uint32' }, { name: 'firstDue', type: 'uint64' },
    { name: 'rail', type: 'uint8' }, { name: 'merchantRef', type: 'bytes32' },
  ],
} as const;

export type PrimaryType = keyof typeof types;
export const PRIMARY_TYPES = Object.keys(types) as PrimaryType[];

// Message shapes (uint8/16/32 as number, uint64/256 as bigint, as viem expects).
export type StatusAttestation = { account: Address; status: number; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type HeartbeatAttestation = { epoch: bigint; validUntil: bigint; deadline: bigint };
export type CapsAttestation = { riskProfile: number; perTxCap: bigint; dailyCap: bigint; monthlyCap: bigint; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type KYAAttestation = {
  account: Address; agentKey: Address; agentDidHash: Hex; kycCredentialHash: Hex; mandateCredentialHash: Hex; kycLevel: number;
  riskProfile: number; jurisdiction: Hex; agentMeasurement: Hex; validUntil: bigint; nonce: bigint; deadline: bigint; fiscoRef: Hex;
};
export type AssetAttestation = { asset: Address; kind: number; status: number; maxWeightBps: number; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type SanctionsAttestation = { target: Address; listed: boolean; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type JurisdictionAttestation = { jurisdiction: Hex; payoutBlocked: boolean; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type AttesterAttestation = { attester: Address; measurement: Hex; active: boolean; nonce: bigint; deadline: bigint; fiscoRef: Hex };
export type AnchorAttestation = { seq: bigint; head: Hex; fiscoBlock: bigint; deadline: bigint };
export type Tier2Approval = { account: Address; callHash: Hex; nonce: bigint; expiresAt: bigint };
export type OwnerAction = { account: Address; action: number; payloadHash: Hex; nonce: bigint; expiresAt: bigint; fiscoRef: Hex };
export type SoterApproval = { account: Address; digest: Hex; bindingHash: Hex; soterCounter: bigint; expiresAt: bigint };
export type StandingOrder = { account: Address; id: number; payee: Address; amount: bigint; period: number; firstDue: bigint; rail: number; merchantRef: Hex };

export type MessageOf = {
  StatusAttestation: StatusAttestation; HeartbeatAttestation: HeartbeatAttestation; CapsAttestation: CapsAttestation;
  KYAAttestation: KYAAttestation; AssetAttestation: AssetAttestation; SanctionsAttestation: SanctionsAttestation;
  JurisdictionAttestation: JurisdictionAttestation; AttesterAttestation: AttesterAttestation; AnchorAttestation: AnchorAttestation;
  Tier2Approval: Tier2Approval; OwnerAction: OwnerAction; SoterApproval: SoterApproval; StandingOrder: StandingOrder;
};

// Our structs are flat (no nested struct members), so encodeType is just the field list.
export function encodeType(t: PrimaryType): string {
  return `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(',')})`;
}
export const typehash = (t: PrimaryType): Hex => keccak256(toHex(encodeType(t)));

// viem's generics cannot follow a primary type chosen at runtime; the MessageOf map keeps callers typed.
type Loose = { data: Record<string, unknown>; primaryType: string; types: Record<string, readonly { name: string; type: string }[]> };

export function structHash<T extends PrimaryType>(t: T, message: MessageOf[T]): Hex {
  const args: Loose = { data: message as Record<string, unknown>, primaryType: t, types: { [t]: types[t] } };
  return hashStruct(args as never);
}

export function digest<T extends PrimaryType>(domain: TypedDataDomain, t: T, message: MessageOf[T]): Hex {
  return hashTypedData({ domain, primaryType: t, message, types: { [t]: types[t] } } as never);
}
