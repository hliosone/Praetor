import { encodeAbiParameters, type Hex } from 'viem';
import { AuthKind } from './constants.js';
import { SOTER_APPROVAL_TUPLE } from './ownerAction.js';
import type { SoterApproval } from './types.js';
import { encodePasskeySignature, type WebAuthnAuth } from './webauthn.js';

// struct OwnerAuth { uint8 kind; bytes data; }
export const OWNER_AUTH_TUPLE = { type: 'tuple', components: [{ name: 'kind', type: 'uint8' }, { name: 'data', type: 'bytes' }] } as const;
export type OwnerAuth = { kind: number; data: Hex };

export const passkeyAuth = (credIdHash: Hex, auth: WebAuthnAuth): OwnerAuth => ({ kind: AuthKind.PASSKEY, data: encodePasskeySignature(credIdHash, auth) });

export const soterAuth = (approval: SoterApproval, attesterSig: Hex): OwnerAuth => ({
  kind: AuthKind.SOTER,
  data: encodeAbiParameters([SOTER_APPROVAL_TUPLE, { type: 'bytes' }], [approval, attesterSig]),
});

// The challenge shown in WeChat for SOTER: the digest as 64 lowercase hex characters, no 0x.
export const soterChallenge = (digest: Hex): string => digest.slice(2).toLowerCase();
