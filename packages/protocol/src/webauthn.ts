// WebAuthn assertion encoding for Coinbase WebAuthn.sol, and a software P-256 authenticator: the automated
// stand-in for a phone's passkey in tests (spec 06). The challenge is the 32-byte EIP-712 digest.
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, encodeAbiParameters, hexToBytes, keccak256, toHex, type Hex } from 'viem';
import { normalizeP256S } from './hash.js';

export const WEBAUTHN_AUTH_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'authenticatorData', type: 'bytes' }, { name: 'clientDataJSON', type: 'string' },
    { name: 'challengeIndex', type: 'uint256' }, { name: 'typeIndex', type: 'uint256' },
    { name: 'r', type: 'uint256' }, { name: 's', type: 'uint256' },
  ],
} as const;

export type WebAuthnAuth = { authenticatorData: Hex; clientDataJSON: string; challengeIndex: bigint; typeIndex: bigint; r: bigint; s: bigint };

export const base64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

// Flags 0x05 = user present + user verified (requireUV = true on-chain).
export function authenticatorData(rpId: string, signCount = 0, flags = 0x05): Hex {
  const out = new Uint8Array(37);
  out.set(sha256(new TextEncoder().encode(rpId)), 0);
  out[32] = flags;
  new DataView(out.buffer).setUint32(33, signCount);
  return bytesToHex(out);
}

export function clientDataJSON(challenge: Hex, origin: string): { json: string; challengeIndex: bigint; typeIndex: bigint } {
  const json = `{"type":"webauthn.get","challenge":"${base64url(hexToBytes(challenge))}","origin":"${origin}","crossOrigin":false}`;
  return { json, challengeIndex: BigInt(json.indexOf('"challenge"')), typeIndex: BigInt(json.indexOf('"type"')) };
}

// The 32-byte message hash the authenticator signs: sha256(authenticatorData || sha256(clientDataJSON)).
export function webAuthnMessageHash(authData: Hex, json: string): Uint8Array {
  const cd = sha256(new TextEncoder().encode(json));
  return sha256(new Uint8Array([...hexToBytes(authData), ...cd]));
}

export type SoftPasskey = { credIdHash: Hex; x: bigint; y: bigint; sign: (challenge: Hex, opts?: { highS?: boolean }) => WebAuthnAuth };

// Deterministic software passkey (RFC 6979 signatures) from a label: same label, same key, same vectors.
export function softPasskey(label: string, rpId = 'praetor.localhost', origin = `https://${rpId}`): SoftPasskey {
  const d = BigInt(keccak256(toHex(`praetor-p256:${label}`))) % (p256.CURVE.n - 1n) + 1n;
  const priv = hexToBytes(toHex(d, { size: 32 }));
  const pub = p256.getPublicKey(priv, false);
  const x = BigInt(bytesToHex(pub.slice(1, 33)));
  const y = BigInt(bytesToHex(pub.slice(33, 65)));
  return {
    credIdHash: keccak256(toHex(`cred:${label}`)),
    x, y,
    sign(challenge, opts) {
      const authData = authenticatorData(rpId);
      const cd = clientDataJSON(challenge, origin);
      const sig = p256.sign(webAuthnMessageHash(authData, cd.json), priv, { lowS: false, prehash: false });
      const low = normalizeP256S(sig.s);
      const s = opts?.highS ? p256.CURVE.n - low : low;
      return { authenticatorData: authData, clientDataJSON: cd.json, challengeIndex: cd.challengeIndex, typeIndex: cd.typeIndex, r: sig.r, s };
    },
  };
}

// userOp.signature for PasskeyValidator and OwnerAuth.data for PASSKEY: abi.encode(credIdHash, WebAuthnAuth).
export const encodePasskeySignature = (credIdHash: Hex, auth: WebAuthnAuth): Hex =>
  encodeAbiParameters([{ type: 'bytes32' }, WEBAUTHN_AUTH_TUPLE], [credIdHash, auth]);
