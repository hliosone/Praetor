import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Address } from 'viem';
import { handler } from '../src/app.js';
import { apiRoutes } from '../src/routes.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const CAFE = '0x0000000000000000000000000000000000ca1e00' as Address;

function app(extra: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const a = express();
  a.use(express.json());
  const r = express.Router();
  const session: express.RequestHandler = (_req, res, next) => { res.locals.account = ACCOUNT; next(); };
  apiRoutes(r, handler, session, { labels: async (account: Address, labels: unknown) => { calls.push({ account, labels }); }, ...extra } as never);
  a.use('/api', r);
  return { a, calls };
}

describe('payee names (spec 07 /payments)', () => {
  it('stores the name the owner gave a payee for its own account, for the agent to resolve', async () => {
    const { a, calls } = app();
    await request(a).post('/api/payees/label').send({ address: CAFE, label: 'Café Lumen' }).expect(204);
    expect(calls).toEqual([{ account: ACCOUNT, labels: [{ address: CAFE, label: 'Café Lumen' }] }]);
  });

  it('refuses a name without an address or an empty name', async () => {
    const { a, calls } = app();
    expect((await request(a).post('/api/payees/label').send({ label: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await request(a).post('/api/payees/label').send({ address: CAFE, label: '' })).status).toBeGreaterThanOrEqual(400);
    expect(calls).toEqual([]);
  });
});

describe('agent key rotation and revocation (F10)', () => {
  const action = (kind: number) => ({ account: ACCOUNT, action: kind, payloadHash: `0x${'11'.repeat(32)}`, nonce: '1', expiresAt: '1800000000', fiscoRef: `0x${'00'.repeat(32)}` });
  const assertion = { id: 'c', response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' } };

  it('rotates to the next key of the signed-in account', async () => {
    const { a } = app({ rotation: { rotate: async (account: Address) => ({ agentKey: '0x01', account }) } });
    expect((await request(a).post('/api/agent/rotate').expect(200)).body).toEqual({ agentKey: '0x01', account: ACCOUNT });
  });

  it('asks the bank to revoke the mandates of agent keys Base dropped, after a revoke or a new key lands', async () => {
    for (const [kind, success, expected] of [[6, true, 1], [5, true, 1], [6, false, 0], [0, true, 0]] as const) {
      const revoked: Address[] = [];
      const { a } = app({ ownerActions: { submit: async () => ({ success, txHash: null }) }, revokeMandates: async (account: Address) => { revoked.push(account); } });
      await request(a).post('/api/owner-actions/submit').send({ ownerAction: action(kind), payload: '0x', assertion }).expect(200);
      expect(revoked.length, `kind ${kind} success ${success}`).toBe(expected);
    }
  });
});

describe('owner actions for devices and recovery (F10 step 6)', () => {
  it('prepares SET_OWNER_KEY for a new passkey and CANCEL_RECOVERY for a pending recovery', async () => {
    const seen: unknown[] = [];
    const { a } = app({ ownerActions: { prepare: async (_acc: Address, args: unknown) => { seen.push(args); return { digest: '0x' }; } } });
    await request(a).post('/api/owner-actions/prepare').send({ kind: 9, credIdHash: `0x${'ab'.repeat(32)}`, x: '0x01', y: '0x02' }).expect(200);
    await request(a).post('/api/owner-actions/prepare').send({ kind: 10, recoveryPayloadHash: `0x${'cd'.repeat(32)}` }).expect(200);
    expect(seen).toEqual([
      { kind: 9, account: ACCOUNT, credIdHash: `0x${'ab'.repeat(32)}`, x: 1n, y: 2n },
      { kind: 10, account: ACCOUNT, recoveryPayloadHash: `0x${'cd'.repeat(32)}` },
    ]);
  });
});

describe('sandbox faucet route (interim, D48)', () => {
  it('funds the signed-in account, naming the client address for the rate limit', async () => {
    const seen: unknown[] = [];
    const { a } = app({ sandbox: { fund: async (account: Address, client: string) => { seen.push({ account, client: typeof client }); return { txHash: '0x01', amount: '5000000000' }; } } });
    expect((await request(a).post('/api/sandbox/faucet').send({}).expect(200)).body).toEqual({ txHash: '0x01', amount: '5000000000' });
    expect(seen).toEqual([{ account: ACCOUNT, client: 'string' }]);
  });
});

describe('web push subscriptions (spec 07 PWA)', () => {
  // A browser's own push service: the notifier posts only to those (isPushEndpoint).
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPx', auth: 'au' } };
  const store = (saved: unknown[], existing: string[] = []) => ({
    subscribe: async (account: Address, s: unknown) => { saved.push({ account, s }); },
    list: async () => existing.map((endpoint) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } })),
  });

  it('stores the browser\'s push subscription for the signed-in account', async () => {
    const saved: unknown[] = [];
    const { a } = app({ push: store(saved) });
    await request(a).post('/api/push/subscribe').send(sub).expect(204);
    expect(saved).toEqual([{ account: ACCOUNT, s: sub }]);
  });

  it('refuses a subscription whose endpoint is not https', async () => {
    const saved: unknown[] = [];
    const { a } = app({ push: store(saved) });
    expect((await request(a).post('/api/push/subscribe').send({ ...sub, endpoint: 'http://fcm.googleapis.com/fcm/send/abc' })).status).toBeGreaterThanOrEqual(400);
    expect(saved).toEqual([]);
  });

  it('refuses an endpoint that is not a browser push service: the notifier would post to it (SSRF)', async () => {
    const saved: unknown[] = [];
    const { a } = app({ push: store(saved) });
    for (const endpoint of ['https://api:3200/internal/push-subscriptions', 'https://10.88.0.4/', 'https://evil.example/collect', 'https://fcm.googleapis.com:8443/x']) {
      expect((await request(a).post('/api/push/subscribe').send({ ...sub, endpoint })).status, endpoint).toBeGreaterThanOrEqual(400);
    }
    expect(saved).toEqual([]);
  });

  it('keeps at most ten subscriptions per account; a browser that subscribes again still updates its own', async () => {
    const saved: unknown[] = [];
    const ten = Array.from({ length: 10 }, (_, i) => `https://fcm.googleapis.com/fcm/send/${i}`);
    const { a } = app({ push: store(saved, ten) });
    await request(a).post('/api/push/subscribe').send(sub).expect(409);
    await request(a).post('/api/push/subscribe').send({ ...sub, endpoint: ten[3] }).expect(204);
    expect(saved).toEqual([{ account: ACCOUNT, s: { ...sub, endpoint: ten[3] } }]);
  });
});
