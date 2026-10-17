import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createRunnerApp } from '../src/app.js';
import type { Runner, TurnResult } from '../src/runner.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
function app(fake = true) {
  const turns: string[] = [];
  const models: string[] = [];
  const runner = { turn: async (_a: string, t: string): Promise<TurnResult> => { turns.push(t); return { text: 'ok', tools: [], sessionId: 's' }; }, transcript: async () => [] } as unknown as Runner;
  const a = createRunnerApp({ runner, token: 'agent-token', allowModelOverride: fake, setModel: (_acc, m) => models.push(m) });
  return { a, turns, models };
}
const auth = { authorization: 'Bearer agent-token' };

describe('agent-runner API', () => {
  it('needs the internal token', async () => {
    await request(app().a).post('/wake').send({ account: ACCOUNT, reason: 'BAND' }).expect(401);
  });

  it('wake queues a turn built from the reason and context and records its result', async () => {
    const { a, turns } = app();
    await request(a).post('/wake').set(auth).send({ account: ACCOUNT, reason: 'BAND', context: { weights: { tXAU: 3610 }, bands: { tXAU: { minBps: 2000, maxBps: 3500 } }, rebalancesToday: 0, maxRebalancesPerDay: 1 } }).expect(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(turns[0]).toMatch(/outside its band/);
    expect((await request(a).get(`/accounts/${ACCOUNT}/last`).set(auth).expect(200)).body).toMatchObject({ text: 'ok', reason: 'BAND' });
  });

  it('chat streams the turn result as server-sent events', async () => {
    const { a, turns } = app();
    const r = await request(a).post('/chat').set(auth).send({ account: ACCOUNT, message: 'Pay the café 12.50' }).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);
    expect(r.text).toContain('event: result');
    expect(turns).toEqual(['Pay the café 12.50']);
  });

  it('model override only where the fake LLM exists (tests)', async () => {
    await request(app(false).a).put(`/accounts/${ACCOUNT}/model`).set(auth).send({ model: 'fake/scripted' }).expect(403);
    const { a, models } = app(true);
    await request(a).put(`/accounts/${ACCOUNT}/model`).set(auth).send({ model: 'fake/scripted' }).expect(204);
    expect(models).toEqual(['fake/scripted']);
  });
});
