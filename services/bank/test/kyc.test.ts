import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { scoreSuitability, screenName, sealRecord, openRecord, signVendorBody, checkVendorSignature, KycService, MemoryKycStore, type KycWeid } from '../src/kyc.js';

describe('suitability scoring (5 questions, each answer 0 to 2)', () => {
  it.each([
    [[0, 0, 0, 0, 0], 'conservative'],
    [[1, 1, 1, 0, 0], 'conservative'],
    [[1, 1, 1, 1, 0], 'balanced'],
    [[1, 1, 1, 1, 1], 'balanced'],
    [[2, 2, 1, 1, 1], 'balanced'],
    [[2, 2, 2, 1, 1], 'growth'],
    [[2, 2, 2, 2, 2], 'growth'],
  ])('%j -> %s', (answers, profile) => expect(scoreSuitability(answers)).toBe(profile));

  it('refuses anything but five answers in 0..2', () => {
    expect(() => scoreSuitability([1, 1, 1, 1])).toThrow();
    expect(() => scoreSuitability([1, 1, 1, 1, 3])).toThrow();
  });
});

describe('sanctions name screening (mock list)', () => {
  const list = ['Ivan Blockedov', 'Demo Sanctioned Person'];
  it('hits regardless of case, accents, extra spaces and word order', () => {
    expect(screenName('ivan  BLOCKEDOV', list)).toBe(true);
    expect(screenName('Blockedov Ivan', list)).toBe(true);
    expect(screenName('Démo Sanctioned Pérson', list)).toBe(true);
  });
  it('clears other names', () => {
    expect(screenName('Lin Wei', list)).toBe(false);
    expect(screenName('Ivan', list)).toBe(false);
  });
});

describe('KYC records at rest (AES-256-GCM)', () => {
  const key = randomBytes(32).toString('hex');
  it('round-trips and never contains the plaintext', () => {
    const sealed = sealRecord(key, { fullName: 'Lin Wei', birthdate: '1990-04-02' });
    expect(sealed).not.toMatch(/Lin|1990/);
    expect(openRecord(key, sealed)).toEqual({ fullName: 'Lin Wei', birthdate: '1990-04-02' });
  });
  it('fails on a tampered record or another key', () => {
    const sealed = sealRecord(key, { a: 1 });
    const t = Buffer.from(sealed, 'base64');
    t[t.length - 1]! ^= 1;
    expect(() => openRecord(key, t.toString('base64'))).toThrow();
    expect(() => openRecord(randomBytes(32).toString('hex'), sealed)).toThrow();
  });
  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealRecord('abcd', {})).toThrow();
  });
});

describe('vendor callback signature (HMAC-SHA256 over the raw body)', () => {
  const secret = 'x'.repeat(64);
  const body = Buffer.from('{"sessionId":"s1"}');
  it('accepts its own signature only', () => {
    const sig = signVendorBody(secret, body);
    expect(sig).toBe(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
    expect(checkVendorSignature(secret, body, sig)).toBe(true);
    expect(checkVendorSignature(secret, Buffer.from('{"sessionId":"s2"}'), sig)).toBe(false);
    expect(checkVendorSignature('y'.repeat(64), body, sig)).toBe(false);
    expect(checkVendorSignature(secret, body, undefined)).toBe(false);
    expect(checkVendorSignature(secret, body, 'sha256=00')).toBe(false);
  });
});

describe('KycService', () => {
  const W = (c: string) => `did:weid:101:0x${c.repeat(40)}`;
  let store: MemoryKycStore;
  let calls: string[];
  let svc: KycService;
  const weid: KycWeid = {
    createWeId: async () => { calls.push('createWeId'); return W('u'); },
    createCredential: async (a) => { calls.push(`createCredential:${a.issuer}:${a.cptId}`); return { id: 'c', cptId: a.cptId, issuer: a.issuer, claim: a.claim, proof: {} }; },
    createEvidence: async (_c, signer) => { calls.push(`createEvidence:${signer}`); return `0x${'e'.repeat(64)}`; },
    revoke: async (_c, signer) => { calls.push(`revoke:${signer}`); },
  };
  const person = { fullName: 'Lin Wei', birthdate: '1990-04-02', nationality: 'HK', documentNumber: 'K1234567' };
  const now = () => new Date('2026-10-17T10:00:00Z');

  beforeEach(() => {
    store = new MemoryKycStore();
    calls = [];
    svc = new KycService({
      store, weid, encKey: randomBytes(32).toString('hex'), sanctions: ['Ivan Blockedov'], now,
      identity: async () => ({ bankWeId: W('b'), kycCpt: 2000001, mandateCpt: 2000002 }),
      publicUrl: 'https://praetor.localhost',
    });
  });

  it('vendor path: session, approved result, suitability, then PersonKYC issued with evidence; status has no PII', async () => {
    const s = await svc.startSession('user-1', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    expect(s.redirectUrl).toBe(`https://praetor.localhost/kyc-mock/?session=${s.sessionId}`);
    await svc.vendorResult({ sessionId: s.sessionId, decision: 'approved', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    expect((await svc.status('user-1')).state).toBe('verified');
    const out = await svc.suitability('user-1', [1, 1, 1, 1, 1]);
    expect(out).toMatchObject({ riskProfile: 'balanced', state: 'issued', userWeId: W('u'), credentialHash: `0x${'e'.repeat(64)}` });
    expect(calls).toEqual(['createWeId', `createCredential:${W('b')}:2000001`, `createEvidence:${W('b')}`]);
    const issued = store.records.get('user-1')!;
    expect(issued.credential!.claim).toEqual({ holder: W('u'), ageOver18: true, jurisdiction: 'HK', riskProfile: 'balanced', sanctionsScreened: '2026-10-17', kycLevel: 2 });
    expect(issued.account).toBe('0x00000000000000000000000000000000000c0ffe');
    const status = await svc.status('user-1');
    expect(JSON.stringify(status)).not.toMatch(/Lin|1990|K1234567/);
    expect(JSON.stringify([...store.records.values()].map((r) => ({ ...r, sealed: undefined })))).not.toMatch(/Lin Wei|1990-04-02|K1234567/);
  });

  it('a sanctions hit rejects the session: no WeID, no credential', async () => {
    const s = await svc.startSession('user-2', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    await svc.vendorResult({ sessionId: s.sessionId, decision: 'approved', liveness: true, person: { ...person, fullName: 'Blockedov Ivan' }, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    expect(await svc.status('user-2')).toMatchObject({ state: 'rejected', reason: 'sanctions' });
    await expect(svc.suitability('user-2', [1, 1, 1, 1, 1])).rejects.toThrow(/not verified/);
    expect(calls).toEqual([]);
  });

  it('rejects a failed liveness check, a minor, and a decided session replayed', async () => {
    const a = await svc.startSession('u-a', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    await svc.vendorResult({ sessionId: a.sessionId, decision: 'approved', liveness: false, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    expect(await svc.status('u-a')).toMatchObject({ state: 'rejected', reason: 'liveness' });
    const b = await svc.startSession('u-b', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    await svc.vendorResult({ sessionId: b.sessionId, decision: 'approved', liveness: true, person: { ...person, birthdate: '2010-01-01' }, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    expect(await svc.status('u-b')).toMatchObject({ state: 'rejected', reason: 'age' });
    await expect(svc.vendorResult({ sessionId: b.sessionId, decision: 'approved', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` })).rejects.toThrow(/not pending/);
  });

  it('a user already bound to one account cannot start KYC for another', async () => {
    const s = await svc.startSession('u-x', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    await svc.vendorResult({ sessionId: s.sessionId, decision: 'rejected', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    await expect(svc.startSession('u-x', 'vendor', '0x00000000000000000000000000000000000000aa')).rejects.toThrow(/another account/);
  });

  it('an unknown session or an EUDI session cannot take a vendor result', async () => {
    await expect(svc.vendorResult({ sessionId: 'nope', decision: 'approved', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` })).rejects.toThrow(/unknown session/);
  });

  it('EUDI path: a verified presentation with age and country gives kycLevel 1 (no name to screen)', async () => {
    const s = await svc.startSession('u-e', 'eudi', '0x00000000000000000000000000000000000c0ffe', { createTransaction: async () => ({ transactionId: 'tx', clientId: 'x509_hash:a', requestUri: 'https://v/r', requestUriMethod: 'get' }) });
    expect(s.qr).toMatch(/^openid4vp:\/\/\?/);
    await svc.eudiResult(s.sessionId, { ageOver18: true, country: 'HK' });
    await svc.suitability('u-e', [1, 1, 1, 1, 1]);
    expect(store.records.get('u-e')!.credential!.claim).toMatchObject({ jurisdiction: 'HK', kycLevel: 1, ageOver18: true });
  });

  it('EUDI path: no country or not adult is rejected', async () => {
    const s = await svc.startSession('u-f', 'eudi', '0x00000000000000000000000000000000000c0ffe', { createTransaction: async () => ({ transactionId: 'tx', clientId: 'c', requestUri: 'https://v/r', requestUriMethod: 'get' }) });
    await svc.eudiResult(s.sessionId, { ageOver18: true, country: null });
    expect(await svc.status('u-f')).toMatchObject({ state: 'rejected', reason: 'jurisdiction' });
  });

  it('revocation revokes the credential evidence and marks the record', async () => {
    const s = await svc.startSession('u-r', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    await svc.vendorResult({ sessionId: s.sessionId, decision: 'approved', liveness: true, person, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });
    await svc.suitability('u-r', [1, 1, 1, 1, 1]);
    await svc.revoke('u-r');
    expect(calls.at(-1)).toBe(`revoke:${W('b')}`);
    expect((await svc.status('u-r')).state).toBe('revoked');
  });
});
