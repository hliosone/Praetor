// One `opencode serve` per awake account (spec 05), on its own port and directories, stopped after AGENT_IDLE_S idle.
// At most AGENT_MAX_ACTIVE run at once (Q35): at the cap the least recently used idle instance makes room; when all
// are busy, further wakes wait. Each account directory holds only opencode.json and
// AGENTS.md; OpenCode's first-start downloads come from the image (warmDir), never from the network.
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_MD, opencodeConfig } from './opencode-config.js';

export type Spawner = (account: string, port: number, env: Record<string, string>, cwd: string) => { stop(): void };

export type Instance = { account: string; port: number; project: string; base: string; auth: string; model: string; lastUsed: number; busy: number; stop(): void };

export type ManagerOptions = {
  dataDir: string;
  basePort: number;
  password: string;
  maxActive: number;
  idleS: number;
  spawner?: Spawner;
  mcpUrl: string;
  defaultModel: string;
  fakeLlmUrl?: string;
  /** The image's warmed OpenCode config and cache (warm.sh). */
  warmDir: string;
  issueToken(account: string): Promise<string>;
  log?: { info(o: object, m: string): void };
};

export const opencodeSpawner: Spawner = (_account, port, env, cwd) => {
  const p = spawn('opencode', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, stdio: 'ignore' });
  return { stop: () => { p.kill('SIGTERM'); } };
};

export class InstanceManager {
  private running = new Map<string, Instance>();
  private starting = new Map<string, Promise<Instance>>();
  private waiters: (() => void)[] = [];
  private models = new Map<string, string>();
  private nextPort: number;

  constructor(private readonly o: ManagerOptions) {
    this.nextPort = o.basePort;
  }

  /** Tests only (needs the fake LLM): the model of one account, kept with the account so a restart keeps it. */
  setModel(account: string, model: string) {
    const key = account.toLowerCase();
    this.models.set(key, model);
    mkdirSync(join(this.o.dataDir, key), { recursive: true });
    writeFileSync(join(this.o.dataDir, key, 'model'), model);
    const i = this.running.get(key);
    if (i && i.model !== model) this.stop(account);
  }

  modelOf(account: string) {
    const key = account.toLowerCase();
    const known = this.models.get(key);
    if (known) return known;
    const file = join(this.o.dataDir, key, 'model');
    if (this.o.fakeLlmUrl !== undefined && existsSync(file)) {
      const m = readFileSync(file, 'utf8').trim();
      this.models.set(key, m);
      return m;
    }
    return this.o.defaultModel;
  }

  async ensure(account: string): Promise<Instance> {
    const key = account.toLowerCase();
    const r = this.running.get(key);
    if (r) {
      r.lastUsed = Date.now();
      return r;
    }
    let p = this.starting.get(key);
    if (!p) {
      p = this.start(key).finally(() => this.starting.delete(key));
      this.starting.set(key, p);
    }
    return p;
  }

  /** Marks the end of a use (the idle clock starts); a waiting account may now take its slot. */
  release(account: string) {
    const i = this.running.get(account.toLowerCase());
    if (i) i.lastUsed = Date.now();
    this.waiters.shift()?.();
  }

  isRunning(account: string) {
    return this.running.has(account.toLowerCase());
  }

  stopIdle(now = Date.now()) {
    for (const [k, i] of this.running) if (i.busy === 0 && now - i.lastUsed > this.o.idleS * 1000) this.stop(k);
  }

  stop(account: string) {
    const i = this.running.get(account.toLowerCase());
    if (!i) return;
    i.stop();
    this.running.delete(account.toLowerCase());
    this.waiters.shift()?.();
  }

  private async start(account: string): Promise<Instance> {
    const t0 = Date.now();
    while (this.running.size >= this.o.maxActive) {
      const idle = [...this.running.values()].filter((i) => i.busy === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (idle) {
        this.stop(idle.account);
        continue;
      }
      await new Promise<void>((r) => this.waiters.push(r));
    }
    const root = join(this.o.dataDir, account);
    const project = join(root, 'project');
    const model = this.modelOf(account);
    for (const d of ['config/opencode', 'cache', 'data', 'state', 'project']) mkdirSync(join(root, d), { recursive: true });
    const warmConfig = join(this.o.warmDir, 'config', 'opencode');
    if (existsSync(join(warmConfig, 'node_modules')) && !existsSync(join(root, 'config/opencode/node_modules'))) {
      symlinkSync(join(warmConfig, 'node_modules'), join(root, 'config/opencode/node_modules'));
      for (const f of ['package.json', 'package-lock.json']) if (existsSync(join(warmConfig, f))) copyFileSync(join(warmConfig, f), join(root, 'config/opencode', f));
    }
    const warmCache = join(this.o.warmDir, 'cache', 'opencode');
    if (existsSync(warmCache) && !existsSync(join(root, 'cache/opencode'))) cpSync(warmCache, join(root, 'cache/opencode'), { recursive: true });
    writeFileSync(join(project, 'opencode.json'), JSON.stringify(opencodeConfig({ account, model, mcpUrl: this.o.mcpUrl, fakeLlmUrl: this.o.fakeLlmUrl }), null, 2));
    writeFileSync(join(project, 'AGENTS.md'), AGENTS_MD);
    const tSlot = Date.now();
    const token = await this.o.issueToken(account);
    const tToken = Date.now();
    const port = this.nextPort++;
    const env = {
      HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
      OPENCODE_SERVER_PASSWORD: this.o.password, PRAETOR_MCP_TOKEN: token,
    };
    const proc = (this.o.spawner ?? opencodeSpawner)(account, port, env, project);
    const base = `http://127.0.0.1:${port}`;
    const auth = `Basic ${Buffer.from(`opencode:${this.o.password}`).toString('base64')}`;
    for (let i = 0; ; i++) {
      if (await fetch(`${base}/doc`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)) break;
      if (i > 120) {
        proc.stop();
        throw new Error('opencode did not start');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    this.o.log?.info({ account, slotMs: tSlot - t0, tokenMs: tToken - tSlot, readyMs: Date.now() - tToken, running: this.running.size }, 'opencode started');
    const inst: Instance = { account, port, project, base, auth, model, lastUsed: Date.now(), busy: 0, stop: proc.stop };
    this.running.set(account, inst);
    return inst;
  }
}
