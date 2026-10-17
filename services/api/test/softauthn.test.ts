// The software passkey (tests and e2e stand-in for Face ID, spec 10) must produce WebAuthn responses a real
// relying-party library accepts: registration (attestation "none") and login.
import { describe, it, expect } from 'vitest';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { keccak256, toHex } from 'viem';
import { softPasskey } from '@praetor/protocol';

const RP = 'praetor.localhost';
const ORIGIN = 'https://praetor.localhost';

describe('software passkey vs @simplewebauthn/server', () => {
  it('registers: the attested P-256 key is the passkey key, and the credential id hashes to credIdHash', async () => {
    const pk = softPasskey('lin-reg', RP, ORIGIN);
    const options = await generateRegistrationOptions({ rpName: 'Praetor', rpID: RP, userName: 'lin', attestationType: 'none', authenticatorSelection: { userVerification: 'required' } });
    const r = await verifyRegistrationResponse({ response: pk.registration(options.challenge), expectedChallenge: options.challenge, expectedOrigin: ORIGIN, expectedRPID: RP, requireUserVerification: true });
    expect(r.verified).toBe(true);
    const cred = r.registrationInfo!.credential;
    expect(keccak256(toHex(Buffer.from(cred.id, 'base64url')))).toBe(pk.credIdHash);
  });

  it('logs in with an assertion over the server challenge', async () => {
    const pk = softPasskey('lin-login', RP, ORIGIN);
    const reg = await generateRegistrationOptions({ rpName: 'Praetor', rpID: RP, userName: 'lin', attestationType: 'none' });
    const { registrationInfo } = await verifyRegistrationResponse({ response: pk.registration(reg.challenge), expectedChallenge: reg.challenge, expectedOrigin: ORIGIN, expectedRPID: RP });
    const options = await generateAuthenticationOptions({ rpID: RP, userVerification: 'required' });
    const r = await verifyAuthenticationResponse({
      response: pk.authentication(options.challenge), expectedChallenge: options.challenge, expectedOrigin: ORIGIN, expectedRPID: RP,
      credential: registrationInfo!.credential, requireUserVerification: true,
    });
    expect(r.verified).toBe(true);
  });
});
