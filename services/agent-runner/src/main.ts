import pino from 'pino';
import { envSchema } from './env.js';
import { createRunnerApp } from './app.js';
import { InstanceManager } from './instances.js';
import { Runner } from './runner.js';

const env = envSchema.parse(process.env);
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
