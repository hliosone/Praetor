import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceManager, type Spawner } from '../src/instances.js';
import { Runner } from '../src/runner.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const servers: Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

/** A fake `opencode serve`: one session; the message blocks until its permission request is rejected. */
function fakeOpencode(port: number, opts: { askPermission?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const state = { permissions: [] as { id: string }[], rejected: [] as string[], messages: [] as unknown[], auth: '' as string, directories: [] as string[] };
  app.use((req, _res, next) => { state.auth = req.header('authorization') ?? ''; state.directories.push(String(req.query.directory ?? '')); next(); });
  app.get('/doc', (_req, res) => res.json({}));
  app.post('/session', (_req, res) => res.json({ id: 'ses_1' }));
  app.get('/permission', (_req, res) => res.json(state.permissions));
  app.post('/permission/:id/reply', (req, res) => { state.rejected.push(`${req.params.id}:${req.body.reply}`); state.permissions = state.permissions.filter((p) => p.id !== req.params.id); res.json(true); });
  app.post('/session/:id/message', async (req, res) => {
    state.messages.push(req.body);
    if (opts.askPermission) {
      state.permissions.push({ id: 'per_1' });
      for (let i = 0; i < 50 && state.permissions.length; i++) await new Promise((r) => setTimeout(r, 50));
    }
    res.json({ info: { role: 'assistant' }, parts: [{ type: 'text', text: state.permissions.length ? 'stuck' : 'Paid 12.50 USDC.' }] });
  });
  app.get('/session/:id/message', (_req, res) => res.json(state.messages.length === 0 ? [] : [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'pay' }] },
    { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'praetor_pay', state: { status: 'completed', input: { amount: '12.50' }, output: 'Paid 12.50 USDC' } }, { type: 'text', text: 'Paid 12.50 USDC.' }] },
  ]));
  const s = app.listen(port);
  servers.push(s);
  return state;
}

function setup(o: { askPermission?: boolean; max?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-'));
  const states: ReturnType<typeof fakeOpencode>[] = [];
  const envs: Record<string, string>[] = [];
  const spawner: Spawner = (_acc, port, env) => {
    envs.push(env);
    states.push(fakeOpencode(port, o));
    return { stop: () => {} };
  };
  const issued: string[] = [];
  const m = new InstanceManager({
    dataDir: dir, basePort: 41000 + Math.floor(Math.random() * 1000), password: 'pw', maxActive: o.max ?? 2, idleS: 1800,
    spawner, mcpUrl: 'http://mcp:3080/mcp', defaultModel: 'fake/scripted', fakeLlmUrl: 'http://fake-llm:3090', warmDir: dir,
    issueToken: async (a) => { issued.push(a); return `agt_secret_${a}`; },
  });
  return { m, runner: new Runner(m), states, envs, dir, issued };
}

describe('instances', () => {
  it('writes only opencode.json and AGENTS.md into the account directory; the bearer goes to the process env only', async () => {
    const { m, envs, dir, issued } = setup();
    await m.ensure(ACCOUNT);
    expect(issued).toEqual([ACCOUNT]);
    expect(envs[0]!.PRAETOR_MCP_TOKEN).toBe(`agt_secret_${ACCOUNT}`);
    const project = join(dir, ACCOUNT.toLowerCase(), 'project');
    expect(readdirSync(project).sort()).toEqual(['AGENTS.md', 'opencode.json']);
    expect(readFileSync(join(project, 'opencode.json'), 'utf8')).not.toContain('agt_secret');
  });

  it('reuses a running instance and caps how many run at once', async () => {
    const { m, states } = setup({ max: 1 });
    const a = await m.ensure(ACCOUNT);
    expect(await m.ensure(ACCOUNT)).toBe(a);
    const other = m.ensure('0x00000000000000000000000000000000000000aa');
    await new Promise((r) => setTimeout(r, 100));
    expect(states).toHaveLength(1);
    m.release(ACCOUNT);
    m.stopIdle(Date.now() + 1_900_000);
    await other;
    expect(states).toHaveLength(2);
  });
});

describe('turns', () => {
  it('rejects every permission request during the turn and returns the text and the tool steps', async () => {
    const { runner, states } = setup({ askPermission: true });
    const r = await runner.turn(ACCOUNT, 'Pay the café 12.50');
    expect(states[0]!.rejected).toEqual(['per_1:reject']);
    expect(r.text).toBe('Paid 12.50 USDC.');
    expect(r.tools).toEqual([{ tool: 'praetor_pay', status: 'completed', input: { amount: '12.50' }, output: 'Paid 12.50 USDC' }]);
    expect(states[0]!.auth).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`);
    expect((states[0]!.messages[0] as { model: unknown }).model).toEqual({ providerID: 'fake', modelID: 'scripted' });
  });
});
