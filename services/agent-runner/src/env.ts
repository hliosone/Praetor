// The agent-runner's environment, apart from main.ts so that it can be tested without starting the service.
import { z } from 'zod';

export const envSchema = z.object({
  INTERNAL_TOKEN_AGENT: z.string().min(32),
  INTERNAL_TOKEN_MCP: z.string().min(32),
  OPENCODE_SERVER_PASSWORD: z.string().min(16),
  MCP_URL: z.string().url().default('http://mcp:3080'),
  AGENT_MODEL: z.string().default('opencode/deepseek-v4.1-flash-free'),
  // Empty means none: prod sets FAKE_LLM_URL= to override the example file's scripted model.
  FAKE_LLM_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  AGENT_MAX_ACTIVE: z.coerce.number().int().min(1).default(8),
  AGENT_IDLE_S: z.coerce.number().int().default(1800),
  AGENT_DATA_DIR: z.string().default('/data/agents'),
  OPENCODE_WARM_DIR: z.string().default('/opt/oc'),
  PRAETOR_ENV: z.string().default('local'),
  PORT: z.coerce.number().int().default(3100),
});
