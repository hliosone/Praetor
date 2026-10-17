// The mini program's api (/mp, spec 05): sign-in from a wx.login code, the owner's reads, Tier-2 approvals with SOTER
// only, the F2 link; and the web app's UNLINK_WECHAT, which ends the mini program's access.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { decodeFunctionData, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { AuthKind, OwnerActionKind as K, bindingHash, softPasskey, PriceSource, type Policy } from '@praetor/protocol';
import { signSession, SESSION_COOKIE } from '@praetor/protocol/session';
import { createApiApp } from '../src/app.js';
import { MemoryApiStore } from '../src/store.js';
import { apiRoutes, mpRoutes } from '../src/routes.js';
import { MemoryMpBindingStore, MpSessions } from '../src/mp-session.js';
import { WechatError } from '../src/wechat.js';
import { OwnerActions } from '../src/owner-actions.js';
import { WechatLink } from '../src/wechat-link.js';
import { Approvals, MemoryApprovalStore } from '../src/approvals.js';
import { Views, type Reader } from '../src/views.js';

const SECRET = 's'.repeat(64);
const APP_ID = 'wx-test-app';
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const EMAIL = 'lin.private@example.com';
const ZERO = `0x${'00'.repeat(32)}` as Hex;
const T = { usdc: '0x00000000000000000000000000000000000000a1' as Address, txau: '0x00000000000000000000000000000000000000a2' as Address, txag: '0x00000000000000000000000000000000000000a3' as Address };
const pk = softPasskey('mp-routes', 'praetor.localhost', 'https://praetor.localhost');
const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');
// WeChat gives one code per wx.login; "lin:1" and "lin:2" are two codes of the same WeChat user.
const openidOf = (code: string) => `openid-of-${code.split(':')[0]}`;
const soterResult = (raw: string, phone = 'iphone') => JSON.stringify({ raw, counter: 7, uid: `uid-${phone}`, cpu_id: `cpu-${phone}` });

const policy: Policy = {
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 1_000_000_000n,
  payees: [], merchants: [], bands: [{ token: T.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 }],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: 2_000_000_000n, soterEnabled: true,
};
const reader: Reader = {
  balances: async () => ({ [T.usdc]: 5_300_000_000n }),
  price: async () => ({ price8: 100_000_000n, publishTime: 1n, source: PriceSource.PYTH }),
  policy: async () => policy,
  status: async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 1_800_000_900n }),
  kya: async () => ({ agentKey: '0x00000000000000000000000000000000000a6e47' as Address, kycLevel: 2, riskProfile: 2, jurisdiction: '0x484b', validUntil: 1_900_000_000n }),
  caps: async () => ({ perTx: 1n, daily: 1n, monthly: 1n }),
  spent: async () => ({ day: 0n, month: 0n, count: 0n, rebalances: 0n }),
  activity: async () => [{ kind: 'decision', reason: 'OK', tier: 'T1_AUTONOMOUS', target: T.usdc, txHash: '0xaa', valueUsd6: '12500000' }],
  now: async () => 1_800_000_000n,
};

async function setup() {
  const store = new MemoryApiStore();
  const u = await store.createUser(EMAIL);
  await store.setAccount(u.id, ACCOUNT, 1n);
  let chainBinding: Hex = ZERO;
  const used = new Set<string>();
  const attesterCalls: Record<string, unknown>[] = [];
  const tx: Hex[] = [];
  const unlinked: Address[] = [];
  const bundler = { tx: async (_to: Address, data: Hex) => { tx.push(data); return { txHash: `0x${'11'.repeat(32)}` as Hex, success: true }; } };
  // The attester resolves its own code inside the TEE and binds (app, openid, uid, cpu_id), like services/soter-attester.
  const attester = {
    approve: async (b: Record<string, unknown>) => {
      attesterCalls.push(b);
      const r = JSON.parse(String(b.resultJSON));
      const bh = bindingHash({ mpAppId: APP_ID, openid: openidOf(String(b.code)), uid: r.uid, cpuId: r.cpu_id });
      return { soterApproval: { account: String(b.account), digest: `0x${String(b.digestHex)}`, bindingHash: bh, soterCounter: '7', expiresAt: String(b.expiresAt) }, attesterSig: '0xab' as Hex };
    },
  };
  const sessions = new MpSessions({
    secret: SECRET, appId: APP_ID, bindings: new MemoryMpBindingStore(), bindingOf: async () => chainBinding,
    code2session: async (code) => { if (used.has(code)) throw new WechatError('used'); used.add(code); return openidOf(code); },
  });
  const ownerActions = new OwnerActions({ domain: { name: 'Praetor-test', hook: HOOK }, now: async () => 1_800_000_000n, credIdHashOf: async () => pk.credIdHash, bank: { cosign: async () => ({ bankSig: '0xbb' as Hex }) }, bundler });
  const link = new WechatLink({ ownerActions, publicUrl: 'https://praetor.localhost', attester, onLinked: (x) => sessions.linked(x.openidHash, x.account, x.bindingHash) });
  const approvals = new Approvals({
    store: new MemoryApprovalStore(), domain: { name: 'Praetor-test', hook: HOOK }, now: async () => 1_800_000_000n, credIdHashOf: async () => pk.credIdHash,
    bundler, attester, resubmit: async () => ({ success: true, txHash: `0x${'22'.repeat(32)}` as Hex }),
  });
  const views = new Views({ reader, tokens: T });
  const config = { chainId: 84532, domainName: 'Praetor-test', mandateHook: HOOK, usdc: T.usdc, txau: T.txau, txag: T.txag };
  const app = createApiApp({
    store, sessionSecret: SECRET, rpId: 'praetor.localhost', origin: 'https://praetor.localhost', accountFor: async () => ({ address: ACCOUNT }),
    extend: (r, h, session) => apiRoutes(r, h, session, {
      ownerActions, link, approvals, views, config, bindingOf: async () => chainBinding, onWechatUnlinked: async (a: Address) => { unlinked.push(a); await sessions.unlinked(a); },
    } as never),
    mount: (a, h) => {
      const mp = express.Router();
      mpRoutes(mp, h, {
        link, sessions, approvals, views, config,
        standingOrders: { list: async () => ({ orders: [], proposals: [] }) },
        runner: { chat: async () => new Response('event: started\ndata: {}\n\nevent: result\ndata: {"text":"All good.","tools":[]}\n\n', { headers: { 'content-type': 'text/event-stream' } }) },
      });
      a.use('/mp', mp);
    },
  });
  const web = () => {
    const value = signSession(ACCOUNT, SECRET);
    return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(value)}`, csrf: createHmac('sha256', SECRET).update(`csrf|${value}`).digest('base64url') };
  };
  /** F2 through the mini program, signed in as `who`, then the owner's passkey confirmation on the web. */
  const linkPhone = async (who: string, phone = 'iphone') => {
    const guest = (await request(app).post('/mp/session').send({ code: `${who}:1` }).expect(200)).body.token as string;
    const s = await link.start(ACCOUNT);
    const view = (await request(app).get(`/mp/link/${s.id}`).expect(200)).body;
    await request(app).post(`/mp/link/${s.id}/soter`).set('authorization', `Bearer ${guest}`)
      .send({ code: `${who}:2`, resultJSON: soterResult(view.soterChallenge, phone), resultJSONSignature: 'sig', authMode: 'facial' }).expect(200);
    expect((await link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)))).success).toBe(true);
    chainBinding = bindingHash({ mpAppId: APP_ID, openid: openidOf(who), uid: `uid-${phone}`, cpuId: `cpu-${phone}` });
    const r = (await request(app).post('/mp/session').send({ code: `${who}:3` }).expect(200)).body;
    return r.token as string;
  };
  return { app, link, approvals, sessions, attesterCalls, tx, unlinked, web, linkPhone, setChainBinding: (h: Hex) => { chainBinding = h; } };
}

describe('/mp sign-in', () => {
  it('a wx.login code opens a guest session until this WeChat user is linked', async () => {
    const { app } = await setup();
    const r = await request(app).post('/mp/session').send({ code: 'lin:1' }).expect(200);
    expect(r.body).toMatchObject({ account: null });
    await request(app).get('/mp/portfolio').expect(401);
    await request(app).get('/mp/portfolio').set('authorization', `Bearer ${r.body.token}`).expect(403);
    await request(app).post('/mp/session').send({ code: 'lin:1' }).expect(401);
    await request(app).post('/mp/session').send({}).expect(400);
  });

  it('the web session is not a mini program session, and the mini program token is not a web session', async () => {
    const { app, web, linkPhone } = await setup();
    const token = await linkPhone('lin');
    await request(app).get('/mp/portfolio').set('authorization', `Bearer ${signSession(ACCOUNT, SECRET)}`).expect(401);
    await request(app).get('/mp/portfolio').set('cookie', web().cookie).expect(401);
    await request(app).get('/api/me').set('cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}`).expect(401);
  });
});

describe('/mp link (F2) with a signed-in mini program', () => {
  it('records the link only after the passkey confirmation; then the WeChat user signs in to the account', async () => {
    const { app, linkPhone } = await setup();
    const token = await linkPhone('lin');
    const p = await request(app).get('/mp/portfolio').set('authorization', `Bearer ${token}`).expect(200);
    expect(p.body.totalUsd6).toBe('5300000000');
  });

  it('refuses a SOTER result from another WeChat user than the signed-in one', async () => {
    const { app, link } = await setup();
    const eve = (await request(app).post('/mp/session').send({ code: 'eve:1' })).body.token;
    const s = await link.start(ACCOUNT);
    const view = (await request(app).get(`/mp/link/${s.id}`)).body;
    await request(app).post(`/mp/link/${s.id}/soter`).set('authorization', `Bearer ${eve}`)
      .send({ code: 'lin:2', resultJSON: soterResult(view.soterChallenge), resultJSONSignature: 'sig', authMode: 'facial' }).expect(403);
    await request(app).post(`/mp/link/${s.id}/soter`).set('authorization', 'Bearer mp1.0.forged')
      .send({ code: 'lin:3', resultJSON: soterResult(view.soterChallenge), resultJSONSignature: 'sig', authMode: 'facial' }).expect(401);
    expect((await link.status(ACCOUNT, s.id)).state).toBe('waiting');
  });

  it('still takes a scan without a session (the e2e SOTER fixture), and then records no mini program link', async () => {
    const { app, link, setChainBinding } = await setup();
    const s = await link.start(ACCOUNT);
    const view = (await request(app).get(`/mp/link/${s.id}`)).body;
    expect(keccak256(view.linkNonce)).toBe(view.ownerAction.payloadHash);
    await request(app).post(`/mp/link/${s.id}/soter`).send({ code: 'lin:2', resultJSON: soterResult(view.soterChallenge), resultJSONSignature: 'sig', authMode: 'facial' }).expect(200);
    await link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)));
    setChainBinding(bindingHash({ mpAppId: APP_ID, openid: openidOf('lin'), uid: 'uid-iphone', cpuId: 'cpu-iphone' }));
    expect((await request(app).post('/mp/session').send({ code: 'lin:3' })).body.account).toBeNull();
  });
});

describe('/mp reads and approvals of a linked mini program', () => {
  it('reads what the home, activity and payments pages show, and never the owner\'s personal data (I9)', async () => {
    const { app, approvals, linkPhone } = await setup();
    const token = await linkPhone('lin');
    const { id } = await approvals.request({ account: ACCOUNT, calls: [{ to: T.usdc, value: 0n, data: '0xa9059cbb' }], callHash: keccak256(toHex('c')), reason: 'UNKNOWN_PAYEE', summary: 'Pay 300 USDC' });
    const bodies: string[] = [];
    for (const path of ['/mp/config', '/mp/portfolio', '/mp/status', '/mp/agent', '/mp/activity', '/mp/approvals?state=pending', `/mp/approvals/${id}`, '/mp/standing-orders']) {
      const r = await request(app).get(path).set('authorization', `Bearer ${token}`).expect(200);
      bodies.push(r.text);
    }
    expect(JSON.parse(bodies[5]!).approvals).toHaveLength(1);
    expect(JSON.parse(bodies[6]!).tier2.account).toBe(ACCOUNT);
    for (const b of bodies) expect(b).not.toContain(EMAIL);
  });

  it('approves with SOTER from the linked phone: registerApproval with a SOTER owner auth, then the call runs', async () => {
    const { app, approvals, tx, linkPhone } = await setup();
    const token = await linkPhone('lin');
    const { id } = await approvals.request({ account: ACCOUNT, calls: [{ to: T.usdc, value: 0n, data: '0xa9059cbb' }], callHash: keccak256(toHex('c')), reason: 'UNKNOWN_PAYEE', summary: 'Pay 300 USDC' });
    const view = (await request(app).get(`/mp/approvals/${id}`).set('authorization', `Bearer ${token}`)).body;
    const r = await request(app).post(`/mp/approvals/${id}/soter`).set('authorization', `Bearer ${token}`)
      .send({ code: 'lin:4', resultJSON: soterResult(view.soterChallenge), resultJSONSignature: 'sig', authMode: 'facial' }).expect(200);
    expect(r.body.state).toBe('executed');
    const call = decodeFunctionData({ abi: MandateHookAbi, data: tx.at(-1)! });
    expect(call.functionName).toBe('registerApproval');
    expect(((call.args as unknown as unknown[])[1] as { kind: number }).kind).toBe(AuthKind.SOTER);
  });

  it('refuses a SOTER result from another phone before it reaches the attester or the chain', async () => {
    const { app, approvals, attesterCalls, linkPhone } = await setup();
    const token = await linkPhone('lin');
    const { id } = await approvals.request({ account: ACCOUNT, calls: [{ to: T.usdc, value: 0n, data: '0xa9059cbb' }], callHash: keccak256(toHex('c')), reason: 'UNKNOWN_PAYEE', summary: 's' });
    const view = (await request(app).get(`/mp/approvals/${id}`).set('authorization', `Bearer ${token}`)).body;
    const before = attesterCalls.length;
    await request(app).post(`/mp/approvals/${id}/soter`).set('authorization', `Bearer ${token}`)
      .send({ code: 'lin:4', resultJSON: soterResult(view.soterChallenge, 'android'), resultJSONSignature: 'sig', authMode: 'fingerPrint' }).expect(403);
    expect(attesterCalls.length).toBe(before);
    expect((await approvals.get(ACCOUNT, id))!.state).toBe('pending');
  });

  it('rejects a request (stricter needs no signature), and relays the agent chat', async () => {
    const { app, approvals, linkPhone } = await setup();
    const token = await linkPhone('lin');
    const { id } = await approvals.request({ account: ACCOUNT, calls: [{ to: T.usdc, value: 0n, data: '0xa9059cbb' }], callHash: keccak256(toHex('c')), reason: 'UNKNOWN_PAYEE', summary: 's' });
    await request(app).post(`/mp/approvals/${id}/reject`).set('authorization', `Bearer ${token}`).expect(200, { state: 'rejected' });
    const chat = await request(app).post('/mp/agent/chat').set('authorization', `Bearer ${token}`).send({ message: 'How am I doing?' }).expect(200);
    expect(chat.headers['content-type']).toMatch(/text\/event-stream/);
    expect(chat.text).toContain('event: result');
  });

  it('serves exactly these routes: reads, SOTER approvals, the link, the chat; no owner action, no passkey route', () => {
    const r = express.Router();
    mpRoutes(r, ((fn: unknown) => fn) as never, {} as never);
    const routes = r.stack.filter((l) => l.route).map((l) => `${Object.keys((l.route as unknown as { methods: Record<string, boolean> }).methods)[0]!.toUpperCase()} ${l.route!.path}`).sort();
    expect(routes).toEqual([
      'GET /activity', 'GET /agent', 'GET /approvals', 'GET /approvals/:id', 'GET /config', 'GET /link/:id', 'GET /portfolio', 'GET /standing-orders', 'GET /status',
      'POST /agent/chat', 'POST /approvals/:id/reject', 'POST /approvals/:id/soter', 'POST /link/:id/soter', 'POST /session',
    ]);
  });
});

describe('UNLINK_WECHAT from the web app (owner alone, passkey)', () => {
  it('prepares the action over the binding on Base, and its success ends the mini program session', async () => {
    const { app, web, linkPhone, unlinked } = await setup();
    const token = await linkPhone('lin');
    const w = web();
    const prep = (await request(app).post('/api/owner-actions/prepare').set('cookie', w.cookie).set('x-csrf-token', w.csrf).send({ kind: K.UNLINK_WECHAT }).expect(200)).body;
    const binding = bindingHash({ mpAppId: APP_ID, openid: openidOf('lin'), uid: 'uid-iphone', cpuId: 'cpu-iphone' });
    expect(prep.payload).toBe(encodeAbiParameters([{ type: 'bytes32' }], [binding]));
    expect(prep.ownerAction.action).toBe(K.UNLINK_WECHAT);
    const r = await request(app).post('/api/owner-actions/submit').set('cookie', w.cookie).set('x-csrf-token', w.csrf)
      .send({ ownerAction: prep.ownerAction, payload: prep.payload, assertion: pk.authentication(b64(prep.digest)) }).expect(200);
    expect(r.body.success).toBe(true);
    expect(unlinked).toEqual([ACCOUNT]);
    await request(app).get('/mp/portfolio').set('authorization', `Bearer ${token}`).expect(401);
  });

  it('refuses to prepare an unlink when nothing is linked on Base', async () => {
    const { app, web } = await setup();
    const w = web();
    await request(app).post('/api/owner-actions/prepare').set('cookie', w.cookie).set('x-csrf-token', w.csrf).send({ kind: K.UNLINK_WECHAT }).expect(409);
  });
});
