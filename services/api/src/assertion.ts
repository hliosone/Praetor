// A browser WebAuthn assertion (base64url JSON, DER signature) as the hook's WebAuthn.sol and the member services
// take it: exact authenticatorData and clientDataJSON, the indexes of "challenge" and "type", and a low-s signature
// (the api normalises s, spec 06). The challenge must be the digest being authorised.
import type { Hex } from 'viem';
import { P256_N, normalizeP256S, type WebAuthnAuth } from '@praetor/protocol';

export type AssertionJSON = { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string } };

/** r and s of a DER ECDSA signature. */
function der(sig: Buffer): { r: bigint; s: bigint } {
  let i = 0;
  if (sig[i++] !== 0x30) throw new Error('not a DER signature');
  i++; // total length (short form for P-256)
  const int = () => {
    if (sig[i++] !== 0x02) throw new Error('not a DER integer');
    const len = sig[i++]!;
    const v = BigInt(`0x${sig.subarray(i, i + len).toString('hex') || '0'}`);
    i += len;
    return v;
  };
  const r = int();
  const s = int();
  if (r <= 0n || r >= P256_N || s <= 0n || s >= P256_N) throw new Error('signature out of range');
  return { r, s };
}

export function toWebAuthnAuth(a: AssertionJSON, digest: Hex): WebAuthnAuth {
  const clientDataJSON = Buffer.from(a.response.clientDataJSON, 'base64url').toString('utf8');
  const cd = JSON.parse(clientDataJSON) as { type?: string; challenge?: string };
  if (cd.type !== 'webauthn.get') throw new Error('not an assertion');
  if (cd.challenge !== Buffer.from(digest.slice(2), 'hex').toString('base64url')) throw new Error('assertion challenge is not the digest');
  const { r, s } = der(Buffer.from(a.response.signature, 'base64url'));
  return {
    authenticatorData: `0x${Buffer.from(a.response.authenticatorData, 'base64url').toString('hex')}`,
    clientDataJSON,
    challengeIndex: BigInt(clientDataJSON.indexOf('"challenge"')),
    typeIndex: BigInt(clientDataJSON.indexOf('"type"')),
    r,
    s: normalizeP256S(s),
  };
}

/** The member services' assertion shape (bank mandate countersignature, staff assertions). */
export function toMemberAssertion(a: AssertionJSON, digest: Hex, credIdHash: Hex) {
  const w = toWebAuthnAuth(a, digest);
  const hex32 = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
  return { credentialId: credIdHash, authenticatorData: w.authenticatorData, clientDataJSON: w.clientDataJSON, r: hex32(w.r), s: hex32(w.s) };
}
