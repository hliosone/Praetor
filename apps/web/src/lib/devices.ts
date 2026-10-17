// More passkeys and recovery (spec 06 F10 step 6, spec 07 settings): a new device's passkey is registered with the api,
// then added on Base by SET_OWNER_KEY signed by a passkey the account already holds; a pending recovery is cancelled
// by any remaining passkey (CANCEL_RECOVERY, owner alone). The page signs only the exact key or recovery it shows.
import { startRegistration } from '@simplewebauthn/browser';
import { ownerActionPayload, OwnerActionKind as K } from '@praetor/protocol';
import { api, type Me, type Prepared } from './api.js';
import { signAndSubmit } from './passkey.js';

export type OwnerKeyJson = { credIdHash: `0x${string}`; x: `0x${string}`; y: `0x${string}` };
export type RecoveryStatus = { state: 'none' | 'scheduled' | 'cancelled' | 'executed'; payloadHash?: `0x${string}`; executableAt?: string };

export async function addDevice(): Promise<boolean> {
  const options = await api('POST', '/passkeys/options', {});
  const key = await api<OwnerKeyJson>('POST', '/passkeys/verify', { response: await startRegistration({ optionsJSON: options }) });
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.SET_OWNER_KEY, ...key });
  const expected = ownerActionPayload({ kind: K.SET_OWNER_KEY, account, credIdHash: key.credIdHash, x: BigInt(key.x), y: BigInt(key.y) }).payload;
  return (await signAndSubmit(p, K.SET_OWNER_KEY, expected)).success;
}

export async function cancelRecovery(payloadHash: `0x${string}`): Promise<boolean> {
  const { account } = await api<Me>('GET', '/me');
  const p = await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.CANCEL_RECOVERY, recoveryPayloadHash: payloadHash });
  return (await signAndSubmit(p, K.CANCEL_RECOVERY, ownerActionPayload({ kind: K.CANCEL_RECOVERY, account, recoveryPayloadHash: payloadHash }).payload)).success;
}
