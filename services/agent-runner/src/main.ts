import pino from 'pino';
import { z } from 'zod';
import { createRunnerApp } from './app.js';
import { InstanceManager } from './instances.js';
import { Runner } from './runner.js';

const env = z.object({
  INTERNAL_TOKEN_AGENT: z.string().min(32),
  INTERNAL_TOKEN_MCP: z.string().min(32),
  OPENCODE_SERVER_PASSWORD: z.string().min(16),
  MCP_URL: z.string().url().default('http://mcp:3080'),
  AGENT_MODEL: z.string().default('opencode/deepseek-v4.1-flash-free'),
  FAKE_LLM_URL: z.string().url().optional(),
  AGENT_MAX_ACTIVE: z.coerce.number().int().min(1).default(8),
  AGENT_IDLE_S: z.coerce.number().int().default(1800),
  AGENT_DATA_DIR: z.string().default('/data/agents'),
  OPENCODE_WARM_DIR: z.string().default('/opt/oc'),
  PRAETOR_ENV: z.string().default('local'),
  PORT: z.coerce.number().int().default(3100),
}).parse(process.env);
if (env.PRAETOR_ENV === 'prod' && env.FAKE_LLM_URL) throw new Error('prod refuses the fake LLM');

const log = pino();
const manager = new InstanceManager({
  log,
  dataDir: env.AGENT_DATA_DIR, basePort: 4100, password: env.OPENCODE_SERVER_PASSWORD, maxActive: env.AGENT_MAX_ACTIVE, idleS: env.AGENT_IDLE_S,
  mcpUrl: `${env.MCP_URL}/mcp`, defaultModel: env.AGENT_MODEL, fakeLlmUrl: env.FAKE_LLM_URL, warmDir: env.OPENCODE_WARM_DIR,
  // Bounded and retried once: a pooled connection to a restarted mcp container otherwise hangs for Node's 300 s.
  issueToken: async (account) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(`${env.MCP_URL}/internal/agent-token`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_MCP}` }, body: JSON.stringify({ account }), signal: AbortSignal.timeout(15_000) });
        if (!r.ok) throw new Error(`mcp agent token: ${r.status}`);
        return ((await r.json()) as { token: string }).token;
      } catch (e) {
        if (attempt >= 1) throw e;
      }
    }
  },
});
setInterval(() => manager.stopIdle(), 60_000).unref();
const app = createRunnerApp({ runner: new Runner(manager, 180_000, log), token: env.INTERNAL_TOKEN_AGENT, allowModelOverride: !!env.FAKE_LLM_URL, setModel: (a, m) => manager.setModel(a, m), log });
app.listen(env.PORT, () => log.info({ port: env.PORT, model: env.AGENT_MODEL, fake: !!env.FAKE_LLM_URL }, 'agent-runner listening'));
