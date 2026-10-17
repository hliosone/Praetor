import { decodeAbiParameters, type Hex, type TypedDataDomain } from 'viem';
import { digest, types, type MessageOf, type PrimaryType } from '@praetor/protocol';

/** Board kinds in FISCO order (contracts/fisco/src/Board.sol). */
export const KIND_TYPES = [
  'StatusAttestation', 'HeartbeatAttestation', 'CapsAttestation', 'KYAAttestation', 'AssetAttestation', 'SanctionsAttestation',
  'JurisdictionAttestation', 'AttesterAttestation', 'AnchorAttestation',
] as const satisfies readonly PrimaryType[];

/** Decodes a proposal's fields and recomputes, in TS, the digest the member is asked to sign. */
export function decodeFields(kind: number, fields: Hex) {
  const primaryType = KIND_TYPES[kind];
  if (!primaryType) throw new Error(`unknown board kind ${kind}`);
  const [message] = decodeAbiParameters([{ type: 'tuple', components: types[primaryType] as never }], fields) as unknown as [MessageOf[typeof primaryType]];
  return { primaryType, message, digest: (domain: TypedDataDomain) => digest(domain, primaryType, message as never) };
}
