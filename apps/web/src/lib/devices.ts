// More passkeys and recovery (spec 06 F10 step 6, spec 07 settings): a new device's passkey is registered with the api,
// then added on Base by SET_OWNER_KEY signed by a passkey the account already holds; a pending recovery is cancelled
// by any remaining passkey (CANCEL_RECOVERY, owner alone). The page signs only the exact key or recovery it shows, and
// the new key is the one this browser created (read from its own registration), not one the api names (spec 08).
import { startRegistration, type RegistrationResponseJSON } from '@simplewebauthn/browser';
import { keccak256, toHex } from 'viem';
import { ownerActionPayload, OwnerActionKind as K } from '@praetor/protocol';
import { api, type Me, type Prepared } from './api.js';
import { signAndSubmit } from './passkey.js';

export type OwnerKeyJson = { credIdHash: `0x${string}`; x: `0x${string}`; y: `0x${string}` };
export type RecoveryStatus = { state: 'none' | 'scheduled' | 'cancelled' | 'executed'; payloadHash?: `0x${string}`; executableAt?: string };

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
// SubjectPublicKeyInfo of an uncompressed P-256 key: this header (id-ecPublicKey, prime256v1), then 04 || x || y.
const P256_SPKI = '3059301306072a8648ce3d020106082a8648ce3d03010703420004';

/** The owner key of a passkey this browser just created: keccak256 of its raw id and its P-256 point. */
export function ownerKeyOf(reg: RegistrationResponseJSON): { credIdHash: `0x${string}`; x: bigint; y: bigint } {
  if (!reg.response.publicKey) throw new Error('this browser does not expose the public key');
  const k = toHex(fromB64url(reg.response.publicKey));
  if (k.length !== 2 + 182 || !k.startsWith(`0x${P256_SPKI}`)) throw new Error('the new passkey is not a P-256 key');
  return { credIdHash: keccak256(fromB64url(reg.rawId)), x: BigInt(`0x${k.slice(-128, -64)}`), y: BigInt(`0x${k.slice(-64)}`) };
}

export async function addDevice(): Promise<boolean> {
  const options = await api('POST', '/passkeys/options', {});
  const reg = await startRegistration({ optionsJSON: options });
  const mine = ownerKeyOf(reg);
  const key = await api<OwnerKeyJson>('POST', '/passkeys/verify', { response: reg });
  if (key.credIdHash.toLowerCase() !== mine.credIdHash.toLowerCase() || BigInt(key.x) !== mine.x || BigInt(key.y) !== mine.y) {
    throw new Error('the server returned another key than the passkey this device created: not signing');
  }
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.SET_OWNER_KEY, ...key });
  const expected = ownerActionPayload({ kind: K.SET_OWNER_KEY, account, credIdHash: mine.credIdHash, x: mine.x, y: mine.y }).payload;
  return (await signAndSubmit(p, K.SET_OWNER_KEY, expected)).success;
}

export async function cancelRecovery(payloadHash: `0x${string}`): Promise<boolean> {
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.CANCEL_RECOVERY, recoveryPayloadHash: payloadHash });
  return (await signAndSubmit(p, K.CANCEL_RECOVERY, ownerActionPayload({ kind: K.CANCEL_RECOVERY, account, recoveryPayloadHash: payloadHash }).payload)).success;
}
