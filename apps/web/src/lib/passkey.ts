// Passkeys in the browser (Face ID / Touch ID / a security key): registration and sign-in through the api's
// WebAuthn options, and the owner's assertion over a 32-byte digest the page recomputed itself ("what you see is
// what you sign").
import { startAuthentication, startRegistration, type AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { api } from './api.js';

const b64url = (hex: string) => {
  const bytes = hex.replace(/^0x/, '').match(/../g)!.map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function signUp(email: string): Promise<{ account: `0x${string}` }> {
  const { userId } = await api<{ userId: string }>('POST', '/onboarding/start', { email });
  const options = await api('POST', '/onboarding/passkey/options', { userId });
  const response = await startRegistration({ optionsJSON: options });
  return api('POST', '/onboarding/passkey/verify', { userId, response });
}

export async function signIn(): Promise<{ account: `0x${string}` }> {
  const options = await api('POST', '/auth/options');
  const response = await startAuthentication({ optionsJSON: options });
  return api('POST', '/auth/verify', { response });
}

/** The owner's passkey over a digest (owner actions, approvals, the AgentMandate challenge). */
export function assertDigest(digest: `0x${string}`): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: { challenge: b64url(digest), rpId: location.hostname, userVerification: 'required', allowCredentials: [] } });
}

/** Prepare -> sign -> submit, the shape of every owner action. */
export async function signAndSubmit(prepared: { ownerAction: unknown; payload: `0x${string}`; digest: `0x${string}` }) {
  const assertion = await assertDigest(prepared.digest);
  return api<{ success: boolean; txHash: string | null }>('POST', '/owner-actions/submit', { ownerAction: prepared.ownerAction, payload: prepared.payload, assertion });
}
