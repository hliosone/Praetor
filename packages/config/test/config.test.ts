import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { resolveKey, keySet, baseEnvSchema, loadConfig, ConfigError } from '../src/index.js';

const K = '0x' + '11'.repeat(32);
const L = '0x' + '22'.repeat(32);

describe('key sets (D1)', () => {
  it('maps the chain mode and environment to a key set', () => {
    expect(keySet({ PRAETOR_ENV: 'local', CHAIN_MODE: 'fork' })).toBe('LOCAL');
    expect(keySet({ PRAETOR_ENV: 'local-live', CHAIN_MODE: 'live' })).toBe('LIVE');
    expect(keySet({ PRAETOR_ENV: 'local', CHAIN_MODE: 'live', KEY_SET: 'SANDBOX' })).toBe('SANDBOX');
  });

  it('reads the unprefixed name first, then the active set prefix', () => {
    expect(resolveKey('BUNDLER_KEY', { BUNDLER_KEY: K, LOCAL_BUNDLER_KEY: L, CHAIN_MODE: 'fork' })).toBe(K);
    expect(resolveKey('BUNDLER_KEY', { LOCAL_BUNDLER_KEY: L, LIVE_BUNDLER_KEY: K, CHAIN_MODE: 'fork' })).toBe(L);
    expect(resolveKey('BUNDLER_KEY', { LOCAL_BUNDLER_KEY: L, LIVE_BUNDLER_KEY: K, CHAIN_MODE: 'live' })).toBe(K);
    expect(() => resolveKey('BUNDLER_KEY', { CHAIN_MODE: 'fork' })).toThrow(/BUNDLER_KEY/);
  });

  it('refuses a malformed key without echoing it', () => {
    try {
      resolveKey('BUNDLER_KEY', { BUNDLER_KEY: 'plain-sentinel', CHAIN_MODE: 'fork' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain('sentinel');
    }
  });
});

describe('startup validation (spec 11, I13)', () => {
  const ok = { PRAETOR_ENV: 'local', CHAIN_MODE: 'fork', ATTESTATION_MODE: 'simulator', SOTER_FAKE_TENCENT: '0', SANDBOX_ENABLED: '1' };

  it('accepts a local configuration', () => {
    expect(loadConfig(baseEnvSchema, ok).CHAIN_MODE).toBe('fork');
  });

  it('refuses missing or inconsistent config with a clear message', () => {
    expect(() => loadConfig(baseEnvSchema, { ...ok, CHAIN_MODE: 'maybe' })).toThrow(ConfigError);
    expect(() => loadConfig(baseEnvSchema.extend({ BASE_RPC_URL: z.string().url() }), ok)).toThrow(/BASE_RPC_URL/);
  });

  it('prod refuses the simulator, the fake Tencent, the fork, default passwords and an unthrottled sandbox', () => {
    const prod = { ...ok, PRAETOR_ENV: 'prod', CHAIN_MODE: 'live', ATTESTATION_MODE: 'phala', SANDBOX_ENABLED: '0' };
    expect(loadConfig(baseEnvSchema, prod).PRAETOR_ENV).toBe('prod');
    expect(() => loadConfig(baseEnvSchema, { ...prod, ATTESTATION_MODE: 'simulator' })).toThrow(/simulator/);
    expect(() => loadConfig(baseEnvSchema, { ...prod, SOTER_FAKE_TENCENT: '1' })).toThrow(/SOTER_FAKE_TENCENT/);
    expect(() => loadConfig(baseEnvSchema, { ...prod, CHAIN_MODE: 'fork' })).toThrow(/fork/);
    expect(() => loadConfig(baseEnvSchema, { ...prod, MYSQL_ROOT_PASSWORD: 'changeme' })).toThrow(/default password/);
    expect(() => loadConfig(baseEnvSchema, { ...prod, SANDBOX_ENABLED: '1' })).toThrow(/rate limit/);
    expect(loadConfig(baseEnvSchema, { ...prod, SANDBOX_ENABLED: '1', SANDBOX_RATE_LIMIT_PER_HOUR: '30' }).SANDBOX_ENABLED).toBe(true);
  });

  it('only prod triggers the prod refusals (the rehearsal runs the simulator)', () => {
    expect(loadConfig(baseEnvSchema, { ...ok, PRAETOR_ENV: 'rehearsal', CHAIN_MODE: 'live' }).ATTESTATION_MODE).toBe('simulator');
  });
});
