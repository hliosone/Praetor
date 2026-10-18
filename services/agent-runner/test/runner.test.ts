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
function fakeOpencode(port: number, opts: { askPermission?: boolean; hangFirst?: boolean; brokenPermissionList?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  const state = { permissions: [] as { id: string }[], rejected: [] as string[], messages: [] as unknown[], auth: '' as string, directories: [] as string[], sessions: 0, aborted: [] as string[], posted: [] as string[] };
  app.use((req, _res, next) => { state.auth = req.header('authorization') ?? ''; state.directories.push(String(req.query.directory ?? '')); next(); });
  app.get('/doc', (_req, res) => res.json({}));
  app.post('/session', (_req, res) => res.json({ id: `ses_${++state.sessions}` }));
  app.post('/session/:id/abort', (req, res) => { state.aborted.push(req.params.id); res.json(true); });
  app.get('/permission', (_req, res) => (opts.brokenPermissionList ? res.status(400).json({ error: 'schema rejection' }) : res.json(state.permissions)));
  app.post('/permission/:id/reply', (req, res) => { state.rejected.push(`${req.params.id}:${req.body.reply}`); state.permissions = state.permissions.filter((p) => p.id !== req.params.id); res.json(true); });
  app.post('/session/:id/message', async (req, res) => {
    state.posted.push(req.params.id);
    // A tool that never completes: the message stays open until the client gives up.
    if (opts.hangFirst && state.posted.length === 1) return;
    state.messages.push(req.body);
    if (opts.askPermission) {
      state.permissions.push({ id: 'per_1' });
      for (let i = 0; i < 50 && state.permissions.length; i++) await new Promise((r) => setTimeout(r, 50));
    }
    res.json({ info: { role: 'assistant' }, parts: [{ type: 'text', text: state.permissions.length ? 'stuck' : 'Paid 12.50 USDC.' }] });
  });
  app.get('/session/:id/message', (_req, res) => res.json(state.messages.length === 0 ? [] : [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'pay' }] },
    { info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'praetor_pay', state: { status: 'completed', input: { amount: '12.50' }, output: 'Paid 12.50 USDC' } }, { type: 'tool', tool: 'praetor_pay', state: { status: 'error', input: { amount: '5000' }, error: 'Blocked: SANCTIONED' } }, { type: 'text', text: 'Paid 12.50 USDC.' }] },
  ]));
  const s = app.listen(port);
  servers.push(s);
  return state;
}

function setup(o: { askPermission?: boolean; hangFirst?: boolean; brokenPermissionList?: boolean; max?: number } = {}) {
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

  it('reuses a running instance; at the cap, the least recently used idle instance makes room', async () => {
    const { m, states } = setup({ max: 1 });
    const a = await m.ensure(ACCOUNT);
    expect(await m.ensure(ACCOUNT)).toBe(a);
    await m.ensure('0x00000000000000000000000000000000000000aa');
    expect(states).toHaveLength(2);
    expect(m.isRunning(ACCOUNT)).toBe(false);
  });

  it('keeps a model override across restarts of the runner (stored with the account)', async () => {
    const { m, dir } = setup();
    m.setModel(ACCOUNT, 'fake/scripted');
    const opts = { dataDir: dir, basePort: 43000, password: 'pw', maxActive: 1, idleS: 1800, spawner: () => ({ stop() {} }), mcpUrl: 'x', defaultModel: 'opencode/real', warmDir: dir, issueToken: async () => 't' };
    const again = new InstanceManager({ ...opts, fakeLlmUrl: 'http://fake-llm:3090' });
    expect(again.modelOf(ACCOUNT)).toBe('fake/scripted');
    expect(again.modelOf('0x00000000000000000000000000000000000000aa')).toBe('opencode/real');
    // Without the fake LLM (prod) an override file is never honoured.
    expect(new InstanceManager(opts).modelOf(ACCOUNT)).toBe('opencode/real');
  });

  it('waits for a slow start by time, not by attempts: under load opencode may take longer than 30 s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-'));
    const port = 44000 + Math.floor(Math.random() * 1000);
    let stopped = 0;
    // The fake server listens only after 400 ms: with 100 ms allowed the start fails and the process is stopped.
    const spawner: Spawner = (_a, p) => { const t = setTimeout(() => fakeOpencode(p), 400); return { stop: () => { clearTimeout(t); stopped++; } }; };
    const opts = { dataDir: dir, password: 'pw', maxActive: 2, idleS: 1800, spawner, mcpUrl: 'x', defaultModel: 'fake/scripted', fakeLlmUrl: 'http://f', warmDir: dir, issueToken: async () => 't' };
    await expect(new InstanceManager({ ...opts, basePort: port, startTimeoutMs: 100 }).ensure(ACCOUNT)).rejects.toThrow(/did not start within 100 ms/);
    expect(stopped).toBe(1);
    const ok = new InstanceManager({ ...opts, basePort: port + 1, startTimeoutMs: 5_000 });
    expect((await ok.ensure(ACCOUNT)).port).toBe(port + 1);
  });

  it('never evicts a busy instance: a new account waits for a slot', async () => {
    const { m, states } = setup({ max: 1 });
    const a = await m.ensure(ACCOUNT);
    a.busy = 1;
    const other = m.ensure('0x00000000000000000000000000000000000000aa');
    await new Promise((r) => setTimeout(r, 100));
    expect(states).toHaveLength(1);
    a.busy = 0;
    m.release(ACCOUNT);
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
    // A refused action is a tool error in OpenCode: its text is kept as the step's output.
    expect(r.tools).toEqual([
      { tool: 'praetor_pay', status: 'completed', input: { amount: '12.50' }, output: 'Paid 12.50 USDC' },
      { tool: 'praetor_pay', status: 'error', input: { amount: '5000' }, output: 'Blocked: SANCTIONED' },
    ]);
    expect(states[0]!.auth).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`);
    expect((states[0]!.messages[0] as { model: unknown }).model).toEqual({ providerID: 'fake', modelID: 'scripted' });
  });

  it('a turn that times out aborts its session and the next turn starts a new one (RT-84: a stuck tool blocked every later turn)', async () => {
    const { m, states } = setup({ hangFirst: true });
    const runner = new Runner(m, 300);
    await expect(runner.turn(ACCOUNT, 'fetch this page')).rejects.toThrow();
    expect(states[0]!.aborted).toEqual(['ses_1']);
    const r = await runner.turn(ACCOUNT, 'Pay the café 12.50');
    expect(states[0]!.posted).toEqual(['ses_1', 'ses_2']);
    expect(r.sessionId).toBe('ses_2');
  });

  it('aborts the turn at once when OpenCode cannot list its pending permissions: nothing could be rejected (RT-05)', async () => {
    const { m, states } = setup({ hangFirst: true, brokenPermissionList: true });
    const runner = new Runner(m, 60_000);
    const t0 = Date.now();
    await expect(runner.turn(ACCOUNT, 'look at your files')).rejects.toThrow(/permission/);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(states[0]!.aborted).toEqual(['ses_1']);
  });
});
