import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { softPasskey } from '@praetor/protocol';
import { createApiApp } from '../src/app.js';
import { MemoryApiStore } from '../src/store.js';

const RP = 'praetor.localhost';
const ORIGIN = 'https://praetor.localhost';
const SECRET = 's'.repeat(64);
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';

function setup() {
  const store = new MemoryApiStore();
  const salts: bigint[] = [];
  const app = createApiApp({
    store, sessionSecret: SECRET, rpId: RP, origin: ORIGIN,
    accountFor: async (_p, salt) => { salts.push(salt); return { address: ACCOUNT }; },
  });
  return { app, store, salts };
}
const cookies = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
const csrfOf = (c: string) => /praetor_csrf=([^;]+)/.exec(c)![1]!;

async function onboard(app: ReturnType<typeof setup>['app'], label = 'lin') {
  const pk = softPasskey(label, RP, ORIGIN);
  const { body: u } = await request(app).post('/api/onboarding/start').send({ email: `${label}@example.com` }).expect(200);
  const { body: opts } = await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId }).expect(200);
  const v = await request(app).post('/api/onboarding/passkey/verify').send({ userId: u.userId, response: pk.registration(opts.challenge) }).expect(200);
  return { pk, userId: u.userId as string, verify: v, cookie: cookies(v) };
}

describe('onboarding auth (F1 steps 1 to 3)', () => {
  it('creates the user, registers the passkey, computes the counterfactual account and opens a session', async () => {
    const { app } = setup();
    const { verify, cookie, pk, userId } = await onboard(app);
    expect(verify.body).toEqual({ account: ACCOUNT, credIdHash: pk.credIdHash });
    expect(cookie).toMatch(/praetor_session=/);
    const me = await request(app).get('/api/me').set('cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ userId, account: ACCOUNT, email: 'lin@example.com' });
  });

  it('refuses a registration over another challenge, and a second passkey here', async () => {
    const { app } = setup();
    const pk = softPasskey('x', RP, ORIGIN);
    const { body: u } = await request(app).post('/api/onboarding/start').send({ email: 'x@example.com' });
    await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId });
    await request(app).post('/api/onboarding/passkey/verify').send({ userId: u.userId, response: pk.registration('bm90LXRoZS1jaGFsbGVuZ2U') }).expect(400);
    const { body: o2 } = await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId });
    await request(app).post('/api/onboarding/passkey/verify').send({ userId: u.userId, response: pk.registration(o2.challenge) }).expect(200);
    await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId }).expect(409);
  });

  it('logs back in with the passkey', async () => {
    const { app } = setup();
    const { pk } = await onboard(app);
    const { body: opts } = await request(app).post('/api/auth/options').send({}).expect(200);
    const r = await request(app).post('/api/auth/verify').send({ response: pk.authentication(opts.challenge) }).expect(200);
    expect(r.body.account).toBe(ACCOUNT);
    expect(cookies(r)).toMatch(/praetor_session=/);
  });

  it('a logged-in POST needs the CSRF token of its session', async () => {
    const { app } = setup();
    const { cookie } = await onboard(app);
    await request(app).post('/api/auth/logout').set('cookie', cookie).expect(403);
    await request(app).post('/api/auth/logout').set('cookie', cookie).set('x-csrf-token', 'wrong').expect(403);
    await request(app).post('/api/auth/logout').set('cookie', cookie).set('x-csrf-token', csrfOf(cookie)).expect(200);
  });

  it('reads need a session', async () => {
    const { app } = setup();
    await request(app).get('/api/me').expect(401);
  });
});
