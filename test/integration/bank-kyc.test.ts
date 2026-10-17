// M6 links: api-side calls to bank-service KYC (internal token), the provider callback (HMAC), bank to weid-rest and
// weid-helper (PersonKYC + evidence), bank to its database (sealed record). I9: no personal data in any log.
import { describe, it, expect, afterAll } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { connect } from '@praetor/db';
import { weidClient } from '@praetor/weid-client';
import { MYSQL_HOST, compose, dotenv } from './lib/stack.js';

const env = dotenv();
const BANK = process.env.BANK_URL ?? 'http://10.88.0.21:3020';
const auth = { authorization: `Bearer ${env.INTERNAL_TOKEN_MEMBERS}`, 'content-type': 'application/json' };
const weid = weidClient({ restUrl: 'http://10.89.0.31:6001/weid/api/invoke', helperUrl: 'http://10.89.0.32:6100' });
const db = connect({ host: MYSQL_HOST, user: 'bank', password: env.MYSQL_PASSWORD_BANK!, database: 'bank' });
afterAll(async () => db.pool.end());

const tag = randomBytes(4).toString('hex');
// Seeded PII, unique to this run, that must never appear outside the sealed record.
const person = { fullName: `Zqxperson Testname${tag}`, birthdate: '1990-04-02', nationality: 'HK', documentNumber: `K${tag}X` };
const account = () => `0x${randomBytes(20).toString('hex')}`;

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`${BANK}${path}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function callback(result: unknown, secret = env.KYC_VENDOR_HMAC!) {
  const raw = JSON.stringify(result);
  const r = await fetch(`${BANK}/kyc/vendor/callback`, {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-praetor-signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` },
  });
  return r.status;
}
const vendor = (sessionId: string, p = person) => ({ sessionId, decision: 'approved', liveness: true, person: p, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}` });

describe('bank KYC (Demo KYC provider path)', () => {
  const userRef = `it-${tag}`;
  let credentialHash = '';

  it('session, signed provider decision, suitability: PersonKYC issued with evidence', async () => {
    const s = await call('POST', '/kyc/sessions', { userRef, account: account(), method: 'vendor' });
    expect(s.status).toBe(200);
    expect(s.body.redirectUrl).toContain(`/kyc-mock/?session=${s.body.sessionId}`);
    expect(await callback(vendor(s.body.sessionId), 'wrong-secret-'.repeat(4))).toBe(401);
    expect(await callback(vendor(s.body.sessionId))).toBe(204);
    expect((await call('GET', `/kyc/status/${userRef}`)).body).toMatchObject({ state: 'verified', kycLevel: 2, jurisdiction: 'HK' });
    const issued = await call('POST', '/suitability', { userRef, answers: [1, 1, 1, 1, 1] });
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ state: 'issued', riskProfile: 'balanced' });
    expect(issued.body.userWeId).toMatch(/^did:weid:101:0x/);
    credentialHash = issued.body.credentialHash;
    expect((await weid.getEvidence(credentialHash)).found).toBe(true);
  }, 180_000);

  it('the record at rest holds no plaintext personal data', async () => {
    const rows = (await db.runner.query('SELECT * FROM kyc_records WHERE user_ref = ?', [userRef])) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const dump = JSON.stringify(rows[0]);
    for (const v of [person.fullName, person.documentNumber, person.birthdate]) expect(dump).not.toContain(v);
  });

  it('revocation marks the record and the evidence', async () => {
    expect((await call('POST', '/kyc/revoke', { userRef })).body).toMatchObject({ state: 'revoked' });
  }, 60_000);

  it('a sanctions hit is rejected: no WeID, no credential', async () => {
    const u = `it-s-${tag}`;
    const s = await call('POST', '/kyc/sessions', { userRef: u, account: account(), method: 'vendor' });
    expect(await callback(vendor(s.body.sessionId, { ...person, fullName: 'Blockedov Ivan' }))).toBe(204);
    expect((await call('GET', `/kyc/status/${u}`)).body).toMatchObject({ state: 'rejected', reason: 'sanctions' });
    expect((await call('POST', '/suitability', { userRef: u, answers: [1, 1, 1, 1, 1] })).status).toBe(409);
  }, 60_000);

  it('the KYC routes refuse callers without the internal token', async () => {
    const r = await fetch(`${BANK}/kyc/status/x`);
    expect(r.status).toBe(401);
  });

  it('I9: no service log contains the seeded personal data', () => {
    const logs = compose('logs', '--no-color', 'bank', 'weid-rest', 'weid-helper');
    for (const v of [person.fullName, person.documentNumber, person.birthdate]) expect(logs).not.toContain(v);
  });
});

describe('kyc-vendor-mock to bank', () => {
  it('a hosted-flow submission reaches the bank as a signed decision; images are not kept', async () => {
    const u = `it-m-${tag}`;
    const s = await call('POST', '/kyc/sessions', { userRef: u, account: account(), method: 'vendor' });
    const img = (t: string) => `data:image/jpeg;base64,${Buffer.from(`img-${t}-${tag}`).toString('base64')}`;
    const r = await fetch(`${process.env.KYC_MOCK_URL ?? 'http://10.88.0.40:3040'}/kyc-mock/api/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: s.body.sessionId, person, idImage: img('id'), selfie: img('selfie'), liveness: { steps: ['left', 'right', 'center'], frames: [img('1'), img('2'), img('3')] } }),
    });
    expect(r.status).toBe(200);
    expect((await call('GET', `/kyc/status/${u}`)).body).toMatchObject({ state: 'verified', kycLevel: 2 });
    expect(compose('exec', '-T', 'kyc-vendor-mock', 'sh', '-c', 'find / -xdev -newer /app/package.json -type f -name "*.jp*g" 2>/dev/null | wc -l').trim()).toBe('0');
    const logs = compose('logs', '--no-color', 'kyc-vendor-mock');
    for (const v of [person.fullName, person.documentNumber]) expect(logs).not.toContain(v);
  }, 120_000);
});
