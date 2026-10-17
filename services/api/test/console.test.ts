import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { consoleRoutes, type MemberCall } from '../src/console.js';

function setup() {
  const calls: { role: string; method: string; path: string; body?: unknown; session?: string }[] = [];
  const member: MemberCall = async (role, method, path, body, session) => {
    calls.push({ role, method, path, body, session });
    if (path === '/staff/session') return session === 'good' ? { status: 200, body: { label: 'alice' } } : { status: 401, body: { error: 'no staff session' } };
    if (path === '/staff/challenge') return { status: 200, body: { challenge: '0xabc' } };
    return { status: 200, body: { board: 'status', proposalId: '7', digest: '0xdd' } };
  };
  const app = express();
  app.use(express.json());
  const r = express.Router();
  consoleRoutes(r, { member, agents: async () => [{ account: '0x1', status: 'ACTIVE' }] });
  app.use('/api/console', r);
  return { app, calls };
}

describe('consortium console relay (spec 07)', () => {
  it('lists the agents only to a signed-in staff member of any member service (D70)', async () => {
    const { app } = setup();
    await request(app).get('/api/console/agents').expect(401);
    await request(app).get('/api/console/agents').set('x-staff-role', 'bank').set('x-staff-session', 'bad').expect(401);
    await request(app).get('/api/console/agents').set('x-staff-role', 'nobody').set('x-staff-session', 'good').expect(400);
    expect((await request(app).get('/api/console/agents').set('x-staff-role', 'regulator').set('x-staff-session', 'good').expect(200)).body).toEqual({ agents: [{ account: '0x1', status: 'ACTIVE' }] });
  });

  it('relays the staff login of a role to that member service', async () => {
    const { app, calls } = setup();
    expect((await request(app).post('/api/console/regulator/challenge').expect(200)).body).toEqual({ challenge: '0xabc' });
    await request(app).post('/api/console/regulator/login').send({ assertion: { r: '0x1' } }).expect(200);
    expect(calls.map((c) => [c.role, c.path])).toEqual([['regulator', '/staff/challenge'], ['regulator', '/staff/login']]);
  });

  it('opens a proposal only with a staff session the member service confirms', async () => {
    const { app, calls } = setup();
    await request(app).post('/api/console/regulator/open').send({ action: 'status', params: { account: `0x${'11'.repeat(20)}`, status: 2 } }).expect(401);
    await request(app).post('/api/console/regulator/open').set('x-staff-session', 'bad').send({ action: 'status', params: { account: `0x${'11'.repeat(20)}`, status: 2 } }).expect(401);
    expect(calls.filter((c) => c.path === '/status')).toHaveLength(0);
    const r = await request(app).post('/api/console/regulator/open').set('x-staff-session', 'good').send({ action: 'status', params: { account: `0x${'11'.repeat(20)}`, status: 2 } }).expect(200);
    expect(r.body).toMatchObject({ proposalId: '7' });
    expect(calls.at(-1)).toMatchObject({ role: 'regulator', method: 'POST', path: '/status', body: { account: `0x${'11'.repeat(20)}`, status: 2 } });
  });

  it('relays only the console actions, to a known role', async () => {
    const { app } = setup();
    await request(app).post('/api/console/regulator/open').set('x-staff-session', 'good').send({ action: 'staff/enrol', params: {} }).expect(400);
    await request(app).post('/api/console/root/open').set('x-staff-session', 'good').send({ action: 'status', params: {} }).expect(400);
  });

  it('reads and signs a proposal for a staff session (the member service checks the staff assertion itself)', async () => {
    const { app, calls } = setup();
    await request(app).get('/api/console/bank/proposals/status/7').set('x-staff-session', 'good').expect(200);
    await request(app).post('/api/console/bank/proposals/status/7/sign').set('x-staff-session', 'good').send({ assertion: { r: '0x1' } }).expect(200);
    expect(calls.filter((c) => c.path.startsWith('/proposals')).map((c) => `${c.method} ${c.path}`)).toEqual(['GET /proposals/status/7', 'POST /proposals/status/7/sign']);
  });
});
