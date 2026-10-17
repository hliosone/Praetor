// Staff passkey assertions, verified over the exact digest a member service is about to sign (spec 05: a compromised
// api cannot make two members sign a loosening). P-256 with node-free noble code; checks type, challenge, origin,
// rpId hash, user presence and user verification.
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, type Hex } from 'viem';

export type Assertion = { credentialId: Hex; authenticatorData: Hex; clientDataJSON: string; r: Hex; s: Hex };
export type PublicKey = { x: bigint; y: bigint };
export type Expected = { challenge: Hex; rpId: string; origin: string };

export class AssertionError extends Error {}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export function verifyAssertion(key: PublicKey, a: Assertion, e: Expected): void {
  let cd: { type?: string; challenge?: string; origin?: string };
  try {
    cd = JSON.parse(a.clientDataJSON);
  } catch {
    throw new AssertionError('clientDataJSON is not JSON');
  }
  if (cd.type !== 'webauthn.get') throw new AssertionError('clientDataJSON type is not webauthn.get');
  if (cd.challenge !== b64url(hexToBytes(e.challenge))) throw new AssertionError('challenge is not the digest');
  if (cd.origin !== e.origin) throw new AssertionError('unexpected origin');
  const auth = hexToBytes(a.authenticatorData);
  if (auth.length < 37) throw new AssertionError('authenticatorData too short');
  if (bytesToHex(auth.slice(0, 32)) !== bytesToHex(sha256(new TextEncoder().encode(e.rpId)))) throw new AssertionError('unexpected rpId');
  if ((auth[32]! & 0x01) === 0) throw new AssertionError('user presence missing');
  if ((auth[32]! & 0x04) === 0) throw new AssertionError('user verification missing');
  const msg = sha256(new Uint8Array([...auth, ...sha256(new TextEncoder().encode(a.clientDataJSON))]));
  const pub = new Uint8Array([4, ...hexToBytes(`0x${key.x.toString(16).padStart(64, '0')}`), ...hexToBytes(`0x${key.y.toString(16).padStart(64, '0')}`)]);
  const sig = new p256.Signature(BigInt(a.r), BigInt(a.s));
  if (!p256.verify(sig, msg, pub, { prehash: false, lowS: false })) throw new AssertionError('bad signature');
}
