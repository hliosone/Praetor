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

// Minimal CBOR (RFC 8949) for an attestation object: unsigned/negative integers, byte and text strings, maps.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cborHead(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function cbor(v: Cbor): number[] {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') {
    const b = new TextEncoder().encode(v);
    return [...cborHead(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...cborHead(2, v.length), ...v];
  return [...cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
}

/** WebAuthn JSON responses (the shape browsers return and @simplewebauthn/server verifies). */
export type RegistrationJSON = {
  id: string; rawId: string; type: 'public-key'; authenticatorAttachment: 'platform'; clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; attestationObject: string; transports: 'internal'[] };
};
export type AuthenticationJSON = {
  id: string; rawId: string; type: 'public-key'; authenticatorAttachment: 'platform'; clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
};

export type SoftPasskey = {
  credIdHash: Hex; x: bigint; y: bigint;
  /** The WebAuthn credential id (base64url); keccak256 of its bytes is credIdHash. */
  credentialId: string;
  sign: (challenge: Hex, opts?: { highS?: boolean }) => WebAuthnAuth;
  /** navigator.credentials.create() stand-in (attestation "none"), for a base64url server challenge. */
  registration: (challenge: string) => RegistrationJSON;
  /** navigator.credentials.get() stand-in, for a base64url server challenge. */
  authentication: (challenge: string) => AuthenticationJSON;
};

// Deterministic software passkey (RFC 6979 signatures) from a label: same label, same key, same vectors.
export function softPasskey(label: string, rpId = 'praetor.localhost', origin = `https://${rpId}`): SoftPasskey {
  const d = BigInt(keccak256(toHex(`praetor-p256:${label}`))) % (p256.CURVE.n - 1n) + 1n;
  const priv = hexToBytes(toHex(d, { size: 32 }));
  const pub = p256.getPublicKey(priv, false);
  const x = BigInt(bytesToHex(pub.slice(1, 33)));
  const y = BigInt(bytesToHex(pub.slice(33, 65)));
  const rawId = new TextEncoder().encode(`cred:${label}`);
  const credentialId = base64url(rawId);
  const rpIdHash = sha256(new TextEncoder().encode(rpId));
  const clientData = (type: string, challenge: string) => base64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
  return {
    credIdHash: keccak256(toHex(`cred:${label}`)),
    x, y, credentialId,
    registration(challenge) {
      const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, pub.slice(1, 33)], [-3, pub.slice(33, 65)]]));
      // rpIdHash, flags UP|UV|AT, signCount 0, aaguid 0, credential id length + id, COSE key.
      const authData = new Uint8Array([...rpIdHash, 0x45, 0, 0, 0, 0, ...new Uint8Array(16), rawId.length >> 8, rawId.length & 0xff, ...rawId, ...cose]);
      const attestationObject = new Uint8Array(cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
      return {
        id: credentialId, rawId: credentialId, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: clientData('webauthn.create', challenge), attestationObject: base64url(attestationObject), transports: ['internal'] },
      };
    },
    authentication(challenge) {
      const authData = hexToBytes(authenticatorData(rpId, 1));
      const cd = clientData('webauthn.get', challenge);
      const msg = sha256(new Uint8Array([...authData, ...sha256(Buffer.from(cd, 'base64url'))]));
      const sig = p256.sign(msg, priv, { lowS: true, prehash: false });
      return {
        id: credentialId, rawId: credentialId, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: cd, authenticatorData: base64url(authData), signature: base64url(sig.toDERRawBytes()) },
      };
    },
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
