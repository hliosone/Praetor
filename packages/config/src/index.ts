// Service configuration from env only (spec 11): zod validation at startup, key sets (D1), prod refusals (I13).
import { z } from 'zod';

export class ConfigError extends Error {}

export type KeySet = 'LOCAL' | 'LIVE' | 'SANDBOX';
type Env = Record<string, string | undefined>;

/** Which key set a service uses: explicit KEY_SET, else LOCAL on the fork and LIVE on Base Sepolia (D1). */
export function keySet(env: Env): KeySet {
  const explicit = env.KEY_SET;
  if (explicit === 'LOCAL' || explicit === 'LIVE' || explicit === 'SANDBOX') return explicit;
  return env.CHAIN_MODE === 'live' ? 'LIVE' : 'LOCAL';
}

/** A secp256k1 private key: the unprefixed name first (prod server), then the active set's prefix. Never echoed. */
export function resolveKey(name: string, env: Env = process.env): `0x${string}` {
  const value = env[name] || env[`${keySet(env)}_${name}`];
  if (!value) throw new ConfigError(`missing ${name} (or ${keySet(env)}_${name})`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new ConfigError(`${name} is not a 32-byte hex key`);
  return value as `0x${string}`;
}

const flag = z.enum(['0', '1']).default('0').transform((v) => v === '1');

export const baseEnvSchema = z.object({
  PRAETOR_ENV: z.enum(['local', 'local-live', 'rehearsal', 'prod']).default('local'),
  CHAIN_MODE: z.enum(['fork', 'live']).default('fork'),
  ATTESTATION_MODE: z.enum(['simulator', 'phala']).default('simulator'),
  SOTER_FAKE_TENCENT: flag,
  SANDBOX_ENABLED: flag,
  SANDBOX_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().optional(),
  MYSQL_ROOT_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const DEFAULT_PASSWORDS = new Set(['', 'changeme', 'password', 'root', 'praetor', 'secret', 'admin']);

/** Parses env with the service's schema; refuses to start on missing or inconsistent config. */
export function loadConfig<S extends z.ZodTypeAny>(schema: S, env: Env = process.env): z.infer<S> {
  const r = schema.safeParse(env);
  if (!r.success) {
    const why = r.error.issues.map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`invalid configuration: ${why}`);
  }
  const cfg = r.data as z.infer<typeof baseEnvSchema>;
  if (cfg.PRAETOR_ENV === 'prod') refuseInProd(cfg, env);
  return r.data;
}

// Only PRAETOR_ENV=prod triggers these, so the rehearsal can still start with the simulator (spec 11).
function refuseInProd(cfg: z.infer<typeof baseEnvSchema>, env: Env): void {
  if (cfg.ATTESTATION_MODE === 'simulator') throw new ConfigError('prod refuses ATTESTATION_MODE=simulator (I13)');
  if (cfg.SOTER_FAKE_TENCENT) throw new ConfigError('prod refuses SOTER_FAKE_TENCENT=1');
  if (cfg.CHAIN_MODE === 'fork') throw new ConfigError('prod refuses CHAIN_MODE=fork');
  for (const [k, v] of Object.entries(env)) {
    if ((k === 'MYSQL_ROOT_PASSWORD' || k.startsWith('MYSQL_PASSWORD_') || k === 'OPENCODE_SERVER_PASSWORD') && v !== undefined && DEFAULT_PASSWORDS.has(v)) {
      throw new ConfigError(`prod refuses a default password in ${k}`);
    }
  }
  if (cfg.SANDBOX_ENABLED && !cfg.SANDBOX_RATE_LIMIT_PER_HOUR) throw new ConfigError('prod refuses SANDBOX_ENABLED without a rate limit');
}
