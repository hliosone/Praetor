import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, getAddress, keccak256, toHex, type Hex } from 'viem';
import { digest, praetorDomain, types, type MessageOf } from '@praetor/protocol';
import { decodeFields, KIND_TYPES } from '../src/index.js';

describe('proposal fields (spec 04)', () => {
  it('maps every board kind to its EIP-712 type', () => {
    expect(KIND_TYPES).toEqual(['StatusAttestation', 'HeartbeatAttestation', 'CapsAttestation', 'KYAAttestation', 'AssetAttestation',
      'SanctionsAttestation', 'JurisdictionAttestation', 'AttesterAttestation', 'AnchorAttestation']);
  });

  it('decodes a proposal and recomputes the digest the member will sign', () => {
    const msg: MessageOf['StatusAttestation'] = { account: getAddress('0x00000000000000000000000000000000000000a1'), status: 2, nonce: 3n, deadline: 1_900_000_000n, fiscoRef: keccak256(toHex('r')) };
    const fields = encodeAbiParameters([{ type: 'tuple', components: types.StatusAttestation as never }], [msg as never]) as Hex;
    const d = decodeFields(0, fields);
    expect(d.primaryType).toBe('StatusAttestation');
    expect(d.message).toEqual(msg);
    const domain = praetorDomain('Praetor-local', '0x00000000000000000000000000000000DeaDBeef');
    expect(d.digest(domain)).toBe(digest(domain, 'StatusAttestation', msg));
  });
});
