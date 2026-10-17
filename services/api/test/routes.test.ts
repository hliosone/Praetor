import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Address } from 'viem';
import { handler } from '../src/app.js';
import { apiRoutes } from '../src/routes.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const CAFE = '0x0000000000000000000000000000000000ca1e00' as Address;

function app() {
  const calls: unknown[] = [];
  const a = express();
  a.use(express.json());
  const r = express.Router();
  const session: express.RequestHandler = (_req, res, next) => { res.locals.account = ACCOUNT; next(); };
  apiRoutes(r, handler, session, { labels: async (account: Address, labels: unknown) => { calls.push({ account, labels }); } } as never);
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
