// F10 step 6 on the api: a second passkey (SET_OWNER_KEY, signed by a current one), sign-in only with passkeys the
// account holds on Base, and the lost-passkey path (new passkey, then the bank's own re-KYC and the 48 h delay).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { softPasskey } from '@praetor/protocol';
import { createApiApp } from '../src/app.js';
import { MemoryApiStore } from '../src/store.js';

const RP = 'praetor.localhost';
const ORIGIN = 'https://praetor.localhost';
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const cookies = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
const csrfOf = (c: string) => /praetor_csrf=([^;]+)/.exec(c)![1]!;

function setup() {
  const store = new MemoryApiStore();
  const onChain = new Set<string>();
  const started: unknown[] = [];
  const app = createApiApp({
    store, sessionSecret: 's'.repeat(64), rpId: RP, origin: ORIGIN,
    accountFor: async () => ({ address: ACCOUNT }),
    isOwnerKey: async (_account, credIdHash) => onChain.has(credIdHash),
    recovery: {
      start: async (userRef, account, key) => { started.push({ userRef, account, key }); return { redirectUrl: 'https://praetor.localhost/kyc-mock/?session=r1' }; },
      status: async () => ({ state: 'scheduled', executableAt: '1800172800' }),
      execute: async () => ({ success: true, txHash: '0x01' }),
    },
  });
  return { app, store, onChain, started };
}

async function onboard(app: ReturnType<typeof setup>['app'], onChain: Set<string>) {
  const pk = softPasskey('lin', RP, ORIGIN);
  const { body: u } = await request(app).post('/api/onboarding/start').send({ email: 'lin@example.com' });
  const { body: o } = await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId });
  const v = await request(app).post('/api/onboarding/passkey/verify').send({ userId: u.userId, response: pk.registration(o.challenge) }).expect(200);
  onChain.add(pk.credIdHash);
  return { pk, userId: u.userId as string, cookie: cookies(v) };
}

const signIn = async (app: ReturnType<typeof setup>['app'], pk: ReturnType<typeof softPasskey>) => {
  const { body: o } = await request(app).post('/api/auth/options').send({});
  return request(app).post('/api/auth/verify').send({ response: pk.authentication(o.challenge) });
};

describe('passkeys of an account', () => {
  it('registers a second device for the signed-in owner and returns the key for SET_OWNER_KEY; it signs in once Base holds it', async () => {
    const { app, onChain } = setup();
    const { cookie } = await onboard(app, onChain);
    const phone = softPasskey('lin-phone', RP, ORIGIN);
    const { body: o } = await request(app).post('/api/passkeys/options').set('cookie', cookie).set('x-csrf-token', csrfOf(cookie)).send({}).expect(200);
    const v = await request(app).post('/api/passkeys/verify').set('cookie', cookie).set('x-csrf-token', csrfOf(cookie)).send({ response: phone.registration(o.challenge) }).expect(200);
    expect(v.body).toEqual({ credIdHash: phone.credIdHash, x: `0x${phone.x.toString(16)}`, y: `0x${phone.y.toString(16)}` });
    expect((await signIn(app, phone)).status).toBe(401);
    onChain.add(phone.credIdHash);
    expect((await signIn(app, phone)).status).toBe(200);
    const list = await request(app).get('/api/passkeys').set('cookie', cookie).expect(200);
    expect(list.body.passkeys.map((p: { active: boolean }) => p.active)).toEqual([true, true]);
  });
});

describe('recovery when every passkey is lost', () => {
  it('registers the new passkey for the email, then starts the bank\'s re-KYC with it; status and execution are public', async () => {
    const { app, onChain, started } = setup();
    const { userId } = await onboard(app, onChain);
    const fresh = softPasskey('lin-new', RP, ORIGIN);
    const { body: o } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
    expect(o.userId).toBe(userId);
    const v = await request(app).post('/api/recover/verify').send({ userId, response: fresh.registration(o.options.challenge) }).expect(200);
    expect(v.body).toEqual({ redirectUrl: 'https://praetor.localhost/kyc-mock/?session=r1' });
    expect(started).toEqual([{ userRef: userId, account: ACCOUNT, key: { credIdHash: fresh.credIdHash, x: `0x${fresh.x.toString(16)}`, y: `0x${fresh.y.toString(16)}` } }]);
    expect((await signIn(app, fresh)).status).toBe(401);
    expect((await request(app).get(`/api/recover/${userId}`).expect(200)).body).toEqual({ state: 'scheduled', executableAt: '1800172800' });
    expect((await request(app).post(`/api/recover/${userId}/execute`).send({}).expect(200)).body).toEqual({ success: true, txHash: '0x01' });
  });

  it('names none of the account\'s passkeys to whoever types the email (its credIdHash finds the account on Base)', async () => {
    const { app, onChain } = setup();
    const { pk } = await onboard(app, onChain);
    const { body: o } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
    expect(JSON.stringify(o)).not.toContain(pk.credentialId);
    expect(o.options.excludeCredentials ?? []).toEqual([]);
  });

  it('knows no account for an unknown email', async () => {
    const { app } = setup();
    await request(app).post('/api/recover/options').send({ email: 'nobody@example.com' }).expect(404);
  });
});
