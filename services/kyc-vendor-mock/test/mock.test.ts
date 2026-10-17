import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { createMockApp, evaluateLiveness } from '../src/app.js';

const SECRET = 's'.repeat(64);
const img = (tag: string) => `data:image/jpeg;base64,${Buffer.from(`fake-image-${tag}`).toString('base64')}`;
const submission = (o: Record<string, unknown> = {}) => ({
  session: '7b1d2c9e-0000-4000-8000-000000000001',
  person: { fullName: 'Lin Wei', birthdate: '1990-04-02', nationality: 'HK', documentNumber: 'K1234567' },
  idImage: img('id'),
  selfie: img('selfie'),
  liveness: { steps: ['left', 'right', 'center'], frames: [img('f1'), img('f2'), img('f3')] },
  ...o,
});

function setup(bankStatus = 204) {
  const posts: { url: string; body: string; sig: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    posts.push({ url, body: String(init.body), sig: new Headers(init.headers).get('x-praetor-signature') });
    return new Response(null, { status: bankStatus });
  }) as unknown as typeof fetch;
  const app = createMockApp({ bankUrl: 'http://bank:3020', hmacSecret: SECRET, publicUrl: 'https://praetor.localhost', fetch: fetchImpl });
  return { app, posts };
}

describe('scripted liveness', () => {
  it('passes with the three prompts in order and one frame each', () => {
    expect(evaluateLiveness({ steps: ['left', 'right', 'center'], frames: ['a', 'b', 'c'] })).toBe(true);
  });
  it('fails out of order, incomplete, or with identical frames', () => {
    expect(evaluateLiveness({ steps: ['right', 'left', 'center'], frames: ['a', 'b', 'c'] })).toBe(false);
    expect(evaluateLiveness({ steps: ['left', 'right'], frames: ['a', 'b'] })).toBe(false);
    expect(evaluateLiveness({ steps: ['left', 'right', 'center'], frames: ['a', 'a', 'a'] })).toBe(false);
  });
});

describe('the hosted flow', () => {
  it('serves the labelled demo page', async () => {
    const { app } = setup();
    const r = await request(app).get('/kyc-mock/').expect(200);
    expect(r.text).toContain('Demo KYC provider');
  });

  it('posts the decision to the bank with the HMAC of the exact body, image hashes only', async () => {
    const { app, posts } = setup();
    const r = await request(app).post('/kyc-mock/api/submit').send(submission()).expect(200);
    expect(r.body).toEqual({ decision: 'approved', next: 'https://praetor.localhost/onboarding/kyc?session=7b1d2c9e-0000-4000-8000-000000000001' });
    expect(posts).toHaveLength(1);
    const p = posts[0]!;
    expect(p.url).toBe('http://bank:3020/kyc/vendor/callback');
    expect(p.sig).toBe(`sha256=${createHmac('sha256', SECRET).update(p.body).digest('hex')}`);
    const body = JSON.parse(p.body);
    expect(body).toMatchObject({ sessionId: '7b1d2c9e-0000-4000-8000-000000000001', decision: 'approved', liveness: true });
    expect(body.docHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.selfieHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.body).not.toContain('base64');
  });

  it('a failed liveness check is still reported (the bank decides), as such', async () => {
    const { app, posts } = setup();
    await request(app).post('/kyc-mock/api/submit').send(submission({ liveness: { steps: ['left'], frames: [img('x')] } })).expect(200);
    expect(JSON.parse(posts[0]!.body).liveness).toBe(false);
  });

  it('rejects a malformed document (no MRZ fields) without calling the bank', async () => {
    const { app, posts } = setup();
    await request(app).post('/kyc-mock/api/submit').send(submission({ person: { fullName: '', birthdate: 'x', nationality: 'HK', documentNumber: '' } })).expect(400);
    expect(posts).toHaveLength(0);
  });

  it('reports a bank refusal as an error', async () => {
    const { app } = setup(409);
    await request(app).post('/kyc-mock/api/submit').send(submission()).expect(502);
  });
});
