import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { kycPublicRoutes } from '../src/kyc-routes.js';
import { KycService, MemoryKycStore, signVendorBody } from '../src/kyc.js';

const SECRET = 'k'.repeat(64);
function app() {
  const store = new MemoryKycStore();
  const kyc = new KycService({
    store, encKey: randomBytes(32).toString('hex'), sanctions: [], publicUrl: 'https://p',
    identity: async () => ({ bankWeId: 'w', kycCpt: 1, mandateCpt: 2 }),
    weid: { createWeId: async () => 'u', createCredential: async () => ({}) as never, createEvidence: async () => '0x', revoke: async () => {} },
  });
  const a = express();
  a.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  const r = express.Router();
  kycPublicRoutes(r, { kyc, vendorHmac: SECRET });
  a.use(r);
  return { a, kyc, store };
}
const result = (sessionId: string) => ({
  sessionId, decision: 'approved', liveness: true, docHash: `0x${'1'.repeat(64)}`, selfieHash: `0x${'2'.repeat(64)}`,
  person: { fullName: 'Test Person', birthdate: '1990-01-01', nationality: 'HK', documentNumber: 'X1' },
});

describe('POST /kyc/vendor/callback', () => {
  it('needs the HMAC of the exact body', async () => {
    const { a, kyc } = app();
    const s = await kyc.startSession('u1', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    const body = JSON.stringify(result(s.sessionId));
    await request(a).post('/kyc/vendor/callback').set('content-type', 'application/json').send(body).expect(401);
    await request(a).post('/kyc/vendor/callback').set('content-type', 'application/json').set('x-praetor-signature', signVendorBody(SECRET, Buffer.from(body + ' '))).send(body).expect(401);
    await request(a).post('/kyc/vendor/callback').set('content-type', 'application/json').set('x-praetor-signature', signVendorBody(SECRET, Buffer.from(body))).send(body).expect(204);
    expect((await kyc.status('u1')).state).toBe('verified');
  });

  it('answers 409 to a replayed decision and never echoes personal data', async () => {
    const { a, kyc } = app();
    const s = await kyc.startSession('u2', 'vendor', '0x00000000000000000000000000000000000c0ffe');
    const body = JSON.stringify(result(s.sessionId));
    const sig = signVendorBody(SECRET, Buffer.from(body));
    await request(a).post('/kyc/vendor/callback').set('content-type', 'application/json').set('x-praetor-signature', sig).send(body).expect(204);
    const again = await request(a).post('/kyc/vendor/callback').set('content-type', 'application/json').set('x-praetor-signature', sig).send(body);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toMatch(/Test Person|1990/);
  });
});
