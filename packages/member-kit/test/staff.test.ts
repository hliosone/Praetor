import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { softPasskey } from '@praetor/protocol';
import { verifyAssertion, StaffAuth, MemoryStaffStore, StaffError, type Assertion } from '../src/index.js';

const RP = 'praetor.localhost';
const ORIGIN = 'https://praetor.localhost';
const digest = keccak256(toHex('freeze lin'));

function assertion(label: string, challenge: Hex, rpId = RP, origin = ORIGIN): Assertion {
  const pk = softPasskey(label, rpId, origin);
  const a = pk.sign(challenge);
  return { credentialId: pk.credIdHash, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, r: toHex(a.r, { size: 32 }), s: toHex(a.s, { size: 32 }) };
}

describe('WebAuthn assertion over the exact digest', () => {
  const pk = softPasskey('staff-1', RP, ORIGIN);
  const key = { x: pk.x, y: pk.y };
  const ok = { challenge: digest, rpId: RP, origin: ORIGIN };

  it('accepts a user-verified assertion over the digest', () => {
    expect(() => verifyAssertion(key, assertion('staff-1', digest), ok)).not.toThrow();
  });

  it('refuses another challenge, origin, rpId or key', () => {
    expect(() => verifyAssertion(key, assertion('staff-1', keccak256(toHex('loosen'))), ok)).toThrow(/challenge/);
    expect(() => verifyAssertion(key, assertion('staff-1', digest, RP, 'https://evil.example'), ok)).toThrow(/origin/);
    expect(() => verifyAssertion(key, assertion('staff-1', digest, 'evil.example', ORIGIN), ok)).toThrow(/rpId/);
    expect(() => verifyAssertion(key, assertion('staff-2', digest), ok)).toThrow(/signature/);
  });

  it('requires user presence and verification', () => {
    const a = assertion('staff-1', digest);
    const noUv = `${a.authenticatorData.slice(0, 66)}01${a.authenticatorData.slice(68)}` as Hex;
    expect(() => verifyAssertion(key, { ...a, authenticatorData: noUv }, ok)).toThrow(/user verification/);
  });

  it('refuses a malformed clientDataJSON type', () => {
    const a = assertion('staff-1', digest);
    expect(() => verifyAssertion(key, { ...a, clientDataJSON: a.clientDataJSON.replace('webauthn.get', 'webauthn.create') }, ok)).toThrow();
  });
});

describe('staff enrolment (Q28)', () => {
  it('enrols the first staff passkey with the one-time token, once', async () => {
    const auth = new StaffAuth(new MemoryStaffStore(), { enrolToken: 'tok-123', rpId: RP, origin: ORIGIN });
    const pk = softPasskey('staff-1', RP, ORIGIN);
    await expect(auth.enrol('wrong', pk.credIdHash, { x: pk.x, y: pk.y }, 'alice')).rejects.toThrow(StaffError);
    await auth.enrol('tok-123', pk.credIdHash, { x: pk.x, y: pk.y }, 'alice');
    const pk2 = softPasskey('staff-2', RP, ORIGIN);
    await expect(auth.enrol('tok-123', pk2.credIdHash, { x: pk2.x, y: pk2.y }, 'bob')).rejects.toThrow(/used/);
  });

  it('verifies a staff assertion and refuses unknown credentials', async () => {
    const auth = new StaffAuth(new MemoryStaffStore(), { enrolToken: 'tok', rpId: RP, origin: ORIGIN });
    const pk = softPasskey('staff-1', RP, ORIGIN);
    await auth.enrol('tok', pk.credIdHash, { x: pk.x, y: pk.y }, 'alice');
    expect((await auth.verify(digest, assertion('staff-1', digest))).label).toBe('alice');
    await expect(auth.verify(digest, assertion('stranger', digest))).rejects.toThrow(/unknown/);
  });

  it('lets an enrolled staff member add another staff passkey with an assertion over its key', async () => {
    const auth = new StaffAuth(new MemoryStaffStore(), { enrolToken: 'tok', rpId: RP, origin: ORIGIN });
    const a = softPasskey('staff-1', RP, ORIGIN);
    await auth.enrol('tok', a.credIdHash, { x: a.x, y: a.y }, 'alice');
    const b = softPasskey('staff-2', RP, ORIGIN);
    const challenge = StaffAuth.addChallenge(b.credIdHash, { x: b.x, y: b.y });
    await auth.add(assertion('staff-1', challenge), b.credIdHash, { x: b.x, y: b.y }, 'bob');
    expect((await auth.verify(digest, assertion('staff-2', digest))).label).toBe('bob');
  });
});
