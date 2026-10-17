// Staff passkeys for the consortium console: a member service identifies a staff key by keccak256(rawId) and checks
// P-256 signatures as (r, s) with the WebAuthn authenticator data and client data (packages/member-kit/webauthn.ts).
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { keccak256, toHex, type Hex } from 'viem';

const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const big = (b: Uint8Array) => BigInt(toHex(b));

/** DER ECDSA signature -> (r, s), with s made low (the member service, like the hook, refuses high s). */
export function derToRs(der: Uint8Array): { r: Hex; s: Hex } {
  let i = 2;
  const read = () => {
    if (der[i] !== 0x02) throw new Error('not a DER signature');
    const len = der[i + 1]!;
    const v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    return big(v);
  };
  const r = read();
  let s = read();
  if (s > N / 2n) s = N - s;
  return { r: toHex(r, { size: 32 }), s: toHex(s, { size: 32 }) };
}

export type StaffAssertion = { credentialId: Hex; authenticatorData: Hex; clientDataJSON: string; r: Hex; s: Hex };

/** The staff passkey over a 32-byte value (a login challenge or a proposal digest). */
export async function staffAssert(challenge: Hex): Promise<StaffAssertion> {
  const a = await startAuthentication({ optionsJSON: { challenge: b64url(Uint8Array.from(challenge.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))), rpId: location.hostname, userVerification: 'required', allowCredentials: [] } });
  const { r, s } = derToRs(fromB64url(a.response.signature));
  return {
    credentialId: keccak256(fromB64url(a.rawId)),
    authenticatorData: toHex(fromB64url(a.response.authenticatorData)),
    clientDataJSON: new TextDecoder().decode(fromB64url(a.response.clientDataJSON)),
    r, s,
  };
}

/** A new staff passkey on this device: its id hash and P-256 public key, for an enrolled staff member to approve. */
export async function staffEnrol(role: string): Promise<{ credentialId: Hex; x: Hex; y: Hex }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const reg = await startRegistration({
    optionsJSON: {
      challenge: b64url(challenge), rp: { id: location.hostname, name: 'Praetor console' },
      user: { id: b64url(crypto.getRandomValues(new Uint8Array(16))), name: `${role}-staff`, displayName: `${role} staff` },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none',
    },
  });
  if (!reg.response.publicKey) throw new Error('this browser does not expose the public key');
  const key = await crypto.subtle.importKey('spki', fromB64url(reg.response.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return { credentialId: keccak256(fromB64url(reg.rawId)), x: toHex(fromB64url(jwk.x!)), y: toHex(fromB64url(jwk.y!)) };
}
