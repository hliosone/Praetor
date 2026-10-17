// F10 step 6 on the api: a second passkey (SET_OWNER_KEY, signed by a current one), sign-in only with passkeys the
// account holds on Base, and the lost-passkey path (new passkey, then the bank's own re-KYC and the 48 h delay).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { softPasskey } from '@praetor/protocol';
import { createApiApp } from '../src/app.js';
import { MemoryApiStore } from '../src/store.js';
import { MySqlApiStore } from '../src/mysql.js';

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

  it('keeps recovering the first account of an email when someone signs up later with the same (unverified) email', async () => {
    const store = new MemoryApiStore();
    const app = createApiApp({
      store, sessionSecret: 's'.repeat(64), rpId: RP, origin: ORIGIN,
      accountFor: async (p) => ({ address: `0x${p.credIdHash.slice(-40)}` as `0x${string}` }),
      recovery: { start: async () => ({ redirectUrl: 'https://praetor.localhost/kyc-mock/?session=r1' }), status: async () => ({ state: 'none' }), execute: async () => ({}) },
    });
    const signUp = async (label: string) => {
      const { body: u } = await request(app).post('/api/onboarding/start').send({ email: 'lin@example.com' });
      const { body: o } = await request(app).post('/api/onboarding/passkey/options').send({ userId: u.userId });
      await request(app).post('/api/onboarding/passkey/verify').send({ userId: u.userId, response: softPasskey(label, RP, ORIGIN).registration(o.challenge) }).expect(200);
      return u.userId as string;
    };
    const lin = await signUp('lin');
    await signUp('squatter');
    expect((await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200)).body.userId).toBe(lin);
  });

  it('stores no passkey for the account unless the bank starts its re-KYC with it', async () => {
    const store = new MemoryApiStore();
    const app = createApiApp({
      store, sessionSecret: 's'.repeat(64), rpId: RP, origin: ORIGIN, accountFor: async () => ({ address: ACCOUNT }),
      recovery: { start: async () => { throw Object.assign(new Error('no issued PersonKYC from the provider for this user'), { status: 409 }); }, status: async () => ({ state: 'none' }), execute: async () => ({}) },
    });
    const { userId } = await onboard(app, new Set());
    const { body: o } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
    await request(app).post('/api/recover/verify').send({ userId, response: softPasskey('stranger', RP, ORIGIN).registration(o.options.challenge) }).expect(409);
    expect((await store.passkeysOf(userId)).map((p) => p.credIdHash)).toEqual([softPasskey('lin', RP, ORIGIN).credIdHash]);
  });

  it('counts only the passkeys Base holds toward the device limit: recovery attempts by strangers do not fill it', async () => {
    const { app, onChain } = setup();
    const { cookie } = await onboard(app, onChain);
    for (const label of ['s1', 's2', 's3']) {
      const { body: o } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
      await request(app).post('/api/recover/verify').send({ userId: o.userId, response: softPasskey(label, RP, ORIGIN).registration(o.options.challenge) }).expect(200);
    }
    await request(app).post('/api/passkeys/options').set('cookie', cookie).set('x-csrf-token', csrfOf(cookie)).send({}).expect(200);
  });

  it('stores at most five recovery passkeys for a user an hour, from however many clients', async () => {
    const { app, onChain, store } = setup();
    const { userId } = await onboard(app, onChain);
    const attempt = async (label: string) => {
      const { body: o } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
      return request(app).post('/api/recover/verify').send({ userId, response: softPasskey(label, RP, ORIGIN).registration(o.options.challenge) });
    };
    for (const label of ['r1', 'r2', 'r3', 'r4', 'r5']) expect((await attempt(label)).status).toBe(200);
    expect((await attempt('r6')).status).toBe(429);
    expect(await store.passkeysOf(userId)).toHaveLength(6);
  });

  it('a second recovery request for the same email (anyone can make one) leaves the first one\'s registration pending', async () => {
    const { app, onChain } = setup();
    const { userId } = await onboard(app, onChain);
    const { body: mine } = await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
    await request(app).post('/api/recover/options').send({ email: 'lin@example.com' }).expect(200);
    await request(app).post('/api/recover/verify').send({ userId, response: softPasskey('lin-new', RP, ORIGIN).registration(mine.options.challenge) }).expect(200);
  });

  it('knows no account for an unknown email', async () => {
    const { app } = setup();
    await request(app).post('/api/recover/options').send({ email: 'nobody@example.com' }).expect(404);
  });
});

describe('MySqlApiStore passkeys', () => {
  it('lists a user\'s passkeys in registration order: the account\'s first passkey (its address and first op) comes first', async () => {
    const calls: string[] = [];
    const store = new MySqlApiStore({ query: async (sql: string) => { calls.push(sql); return []; } });
    await store.passkeysOf('u1');
    expect(calls[0]).toBe('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at, credential_id');
  });
});
