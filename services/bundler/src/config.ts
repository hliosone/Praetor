import { z } from 'zod';
import { baseEnvSchema, loadConfig, resolveKey } from '@praetor/config';

const schema = baseEnvSchema.extend({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  PORT: z.coerce.number().int().default(3010),
  MYSQL_HOST: z.string().default('mysql'),
  MYSQL_PASSWORD_BUNDLER: z.string().min(16),
  INTERNAL_TOKEN_BUNDLER: z.string().min(32),
  BUNDLER_MAX_REFUSED_PER_DAY: z.coerce.number().int().positive().default(20),
  BUNDLER_SKIP_REFUSED: z.enum(['0', '1']).default('0').transform((v) => v === '1'),
});

export function bundlerConfig(env: Record<string, string | undefined> = process.env) {
  const c = loadConfig(schema, env);
  return { ...c, bundlerKey: resolveKey('BUNDLER_KEY', env), paymasterKey: resolveKey('PAYMASTER_SIGNER_KEY', env) };
}
