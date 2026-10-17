import { describe, it, expect } from 'vitest';
import { weidClient, WeidError, PERSON_KYC_CPT, AGENT_MANDATE_CPT, type Credential } from '../src/index.js';

type Call = { url: string; body: any };
// A scripted fetch: each handler answers one call, in order; every request is recorded.
function fake(...answers: unknown[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const a = answers.shift();
    if (a === undefined) throw new Error('unexpected call');
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, f };
}
const W = (a: string) => `did:weid:101:0x${a.repeat(40)}`;
const opts = (f: typeof fetch) => ({ restUrl: 'http://rest/weid/api/invoke', helperUrl: 'http://helper', fetch: f });

describe('REST calls', () => {
  it('sends the invoke envelope with the invoker and returns respBody', async () => {
    const { calls, f } = fake({ errorCode: 0, errorMessage: 'success', respBody: W('a') });
    const c = weidClient(opts(f));
    expect(await c.createWeId()).toBe(W('a'));
    expect(calls[0]).toEqual({ url: 'http://rest/weid/api/invoke', body: { functionName: 'createWeId', functionArg: {}, transactionArg: {}, v: '1.0.0' } });
  });

  it('throws on a non-zero errorCode even when the call "succeeded" (V3: errors can come with receipt status 1)', async () => {
    const { f } = fake({ errorCode: 100104, errorMessage: 'the weid does not exist', respBody: null });
    await expect(weidClient(opts(f)).getWeIdDocument(W('b'))).rejects.toThrowError(WeidError);
  });

  it('rejects a WeID that is not on chain id 101', async () => {
    const { f } = fake({ errorCode: 0, respBody: 'did:weid:20200:0x' + 'a'.repeat(40) });
    await expect(weidClient(opts(f)).createWeId()).rejects.toThrow(/unexpected WeID/);
  });

  it('trusts an authority issuer only once the read-back says recognized', async () => {
    const { calls, f } = fake(
      { errorCode: 0, respBody: true }, // register
      { errorCode: 0, respBody: true }, // recognize
      { errorCode: 0, respBody: { weId: W('c'), recognized: false } }, // read-back
    );
    await expect(weidClient({ ...opts(f), adminInvoker: 'private_key' }).ensureRecognizedIssuer(W('c'), 'Bank')).rejects.toThrow(/not recognized/);
    expect(calls.map((c) => c.body.functionName)).toEqual(['registerAuthorityIssuer', 'recognizeAuthorityIssuer', 'queryAuthorityIssuer']);
    expect(calls[1]!.body.transactionArg).toEqual({ invokerWeId: 'private_key' });
  });

  it('accepts an issuer already registered under that name when it reads back recognized', async () => {
    const { f } = fake(
      { errorCode: 500202, errorMessage: 'the authority issuer name is duplicated', respBody: null },
      { errorCode: 0, respBody: true },
      { errorCode: 0, respBody: { weId: W('c'), recognized: true } },
    );
    await expect(weidClient(opts(f)).ensureRecognizedIssuer(W('c'), 'Bank')).resolves.toBeUndefined();
  });

  it('registers a CPT as its owner and returns the cpt id', async () => {
    const { calls, f } = fake({ errorCode: 0, respBody: { cptId: 2000001, cptVersion: 1 } });
    expect(await weidClient(opts(f)).registerCpt(W('d'), { title: 'PersonKYC' })).toBe(2000001);
    expect(calls[0]!.body).toMatchObject({ functionName: 'registerCpt', functionArg: { weId: W('d'), cptJsonSchema: { title: 'PersonKYC' } }, transactionArg: { invokerWeId: W('d') } });
  });

  it('creates a credential signed by the issuer (custodial key) with an ISO expiry', async () => {
    const cred = { id: 'x', issuer: W('d'), claim: { a: 1 }, proof: {} };
    const { calls, f } = fake({ errorCode: 0, respBody: cred });
    const out = await weidClient(opts(f)).createCredential({ cptId: 7, issuer: W('d'), expiresAt: new Date('2027-01-01T00:00:00Z'), claim: { a: 1 } });
    expect(out).toEqual(cred);
    expect(calls[0]!.body.functionArg).toEqual({ cptId: 7, issuer: W('d'), expirationDate: '2027-01-01T00:00:00Z', claim: { a: 1 } });
    expect(calls[0]!.body.transactionArg).toEqual({ invokerWeId: W('d') });
  });
});

describe('helper calls', () => {
  const cred: Credential = { id: 'c1', issuer: W('e'), claim: {}, proof: {} } as Credential;

  it('countersigns through the helper and returns the multi-signed credential and its hash', async () => {
    const { calls, f } = fake({ credential: { id: 'outer', issuer: W('f') }, hash: '0xabc' });
    expect(await weidClient(opts(f)).countersign(cred, W('f'))).toEqual({ credential: { id: 'outer', issuer: W('f') }, hash: '0xabc' });
    expect(calls[0]).toEqual({ url: 'http://helper/credentials/countersign', body: { credential: cred, signerWeId: W('f') } });
  });

  it('throws when the helper reports an SDK error', async () => {
    const { f } = fake({ error: 'credential issuer mismatch', errorCode: 100403 });
    await expect(weidClient(opts(f)).countersign(cred, W('f'))).rejects.toThrowError(WeidError);
  });

  it('verify is valid only with a good signature and no revocation', async () => {
    const { f } = fake(
      { valid: true, signature: true, revoked: false, evidence: true, hash: '0x1' },
      { valid: false, signature: true, revoked: true, evidence: true, hash: '0x1' },
    );
    const c = weidClient(opts(f));
    expect(await c.verify(cred, W('e'))).toMatchObject({ valid: true });
    expect(await c.verify(cred, W('e'))).toMatchObject({ valid: false, revoked: true });
  });

  it('a verify answer without the valid flag is not valid', async () => {
    const { f } = fake({ signature: true, revoked: false });
    expect((await weidClient(opts(f)).verify(cred, W('e'))).valid).toBe(false);
  });

  it('revoke must be confirmed by the helper', async () => {
    const { f } = fake({ revoked: false, error: 'no evidence' });
    await expect(weidClient(opts(f)).revoke(cred, W('e'))).rejects.toThrow(/revoke/);
  });
});

describe('pinned checks', () => {
  const bank = W('b'), user = W('u'), other = W('o');
  const kyc = { id: 'k', cptId: 2000001, issuer: bank, claim: {}, proof: {} } as Credential;
  const ok = { valid: true, signature: true, revoked: false, evidence: true };

  it('verifyIssued asks the helper with the pinned issuer and the evidence hash', async () => {
    const { calls, f } = fake(ok);
    expect(await weidClient(opts(f)).verifyIssued(kyc, { issuer: bank, cptId: 2000001, evidenceHash: '0xee' })).toMatchObject({ valid: true });
    expect(calls[0]!.body).toEqual({ credential: kyc, issuerWeId: bank, evidenceHash: '0xee' });
  });

  it('verifyIssued refuses another issuer or another CPT without asking the helper', async () => {
    const { calls, f } = fake();
    const c = weidClient(opts(f));
    expect((await c.verifyIssued({ ...kyc, issuer: other }, { issuer: bank, cptId: 2000001 })).valid).toBe(false);
    expect((await c.verifyIssued({ ...kyc, cptId: 2000002 }, { issuer: bank, cptId: 2000001 })).valid).toBe(false);
    expect(calls).toHaveLength(0);
  });

  const inner = { id: 'i', cptId: 2000002, issuer: user, claim: { principal: user }, proof: {} } as Credential;
  const outer = { id: 'o', cptId: 107, issuer: bank, claim: { credentialList: [inner] }, proof: {} } as unknown as Credential;

  it('verifyMandate checks the outer credential (bank, evidence) and the inner one (principal, signature only)', async () => {
    const { calls, f } = fake(ok, { valid: true, signature: true, revoked: false, evidence: false });
    expect(await weidClient(opts(f)).verifyMandate(outer, { bank, principal: user, cptId: 2000002 })).toMatchObject({ valid: true });
    expect(calls[0]!.body).toEqual({ credential: outer, issuerWeId: bank });
    expect(calls[1]!.body).toEqual({ credential: inner, issuerWeId: user, signatureOnly: true });
  });

  it('verifyMandate refuses an inner credential from someone else, of another CPT, or naming another principal', async () => {
    const c = weidClient(opts(fake().f));
    const wrap = (i: object) => ({ ...outer, claim: { credentialList: [{ ...inner, ...i }] } }) as unknown as Credential;
    expect((await c.verifyMandate(wrap({ issuer: other }), { bank, principal: user, cptId: 2000002 })).valid).toBe(false);
    expect((await c.verifyMandate(wrap({ cptId: 1 }), { bank, principal: user, cptId: 2000002 })).valid).toBe(false);
    expect((await c.verifyMandate(wrap({ claim: { principal: other } }), { bank, principal: user, cptId: 2000002 })).valid).toBe(false);
    expect((await c.verifyMandate({ ...outer, issuer: other } as Credential, { bank, principal: user, cptId: 2000002 })).valid).toBe(false);
  });

  it('verifyMandate is invalid when the inner signature fails, even if the outer one holds', async () => {
    const { f } = fake(ok, { valid: false, signature: false, revoked: false, evidence: false });
    expect((await weidClient(opts(f)).verifyMandate(outer, { bank, principal: user, cptId: 2000002 })).valid).toBe(false);
  });

  it('the CPT schemas carry exactly the spec 05 fields (plus the KYC holder, D28)', () => {
    expect(Object.keys(PERSON_KYC_CPT.properties).sort()).toEqual(['ageOver18', 'holder', 'jurisdiction', 'kycLevel', 'riskProfile', 'sanctionsScreened']);
    expect(Object.keys(AGENT_MANDATE_CPT.properties).sort()).toEqual(['agentKey', 'agentMeasurement', 'mandateHash', 'principal', 'riskProfile', 'scopes', 'wallet']);
  });
});

describe('contracts', () => {
  it('reads the deployed WeIdentity addresses from the helper', async () => {
    const { calls, f } = fake({ weId: '0x76e95182042d96160342ab6370919c6523c1895e', cpt: '0x7c126c5d2ac9509ee68023217b36e4cc3f1cf648' });
    expect((await weidClient(opts(f)).contracts()).weId).toBe('0x76e95182042d96160342ab6370919c6523c1895e');
    expect(calls[0]!.url).toBe('http://helper/contracts');
  });
});
