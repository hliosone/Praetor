// M18 (spec 11): the production override keeps the same services and images, restarts them, rotates their logs,
// never starts the scripted model, and lets Caddy use a real certificate in prod.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const base = parse(read('infra/compose.yml')) as { services: Record<string, unknown> };
const prod = parse(read('infra/compose.prod.yml'), { merge: true, customTags: [{ tag: '!override', collection: 'seq', resolve: (v: unknown) => v } as never] }) as {
  services: Record<string, { restart?: string; logging?: { options?: Record<string, string> }; profiles?: unknown; environment?: Record<string, string>; image?: string; ports?: unknown }>;
};

describe('infra/compose.prod.yml', () => {
  it('overrides only services of the base file and changes no image or port', () => {
    for (const [name, s] of Object.entries(prod.services)) {
      expect(base.services[name], name).toBeDefined();
      expect(s.image, name).toBeUndefined();
      expect(s.ports, name).toBeUndefined();
    }
  });

  it('restarts every long-running service and rotates every log', () => {
    for (const [name, s] of Object.entries(prod.services)) {
      if (name === 'fake-llm') continue;
      expect(s.logging?.options?.['max-size'], name).toBe('10m');
      if (!['wecross-setup', 'weid-deploy'].includes(name)) expect(s.restart, name).toBe('unless-stopped');
    }
  });

  it('never starts the scripted model', () => {
    expect(JSON.stringify(prod.services['fake-llm']?.profiles)).toBe('["test"]');
    expect(read('infra/compose.prod.yml')).toMatch(/fake-llm:\n {4}profiles: !override \[test\]/);
  });

  it('lets Caddy take a real certificate in prod (internal CA by default)', () => {
    expect(prod.services.caddy?.environment?.CADDY_TLS).toBe('${CADDY_TLS:-internal}');
    expect(read('infra/Caddyfile')).toContain('tls {$CADDY_TLS:internal}');
  });

  it('runs each prod refusal without a network, beside the running stack: a second copy cannot take the service\'s fixed IP', () => {
    const ref = parse(read('infra/compose.refusals.yml'), { customTags: [{ tag: '!reset', resolve: () => null } as never] }) as { services: Record<string, { network_mode?: string }> };
    for (const svc of ['bank', 'agent-signer', 'soter-attester', 'agent-runner', 'api']) expect(ref.services[svc]?.network_mode, svc).toBe('none');
    expect(read('scripts/deploy/prod-refusals.sh')).toContain('-f infra/compose.refusals.yml');
  });

  it('has a rehearsal target that runs the smoke suite and the prod refusals', () => {
    const mk = read('Makefile');
    expect(mk).toMatch(/^rehearsal:[\s\S]*?PROD=1[\s\S]*?e2e-smoke[\s\S]*?prod-refusals\.sh/m);
  });
});

describe('infra/live.env (M16, D74)', () => {
  const live = read('infra/live.env');
  it('runs on Base Sepolia with the live deployments at production intervals, and holds no secret', () => {
    for (const l of ['CHAIN_MODE=live', 'BASE_RPC_URL=https://sepolia.base.org', 'DEPLOYMENTS_FILE=infra/deployments/base-sepolia.json', 'FISCO_DEPLOYMENTS_FILE=infra/deployments/fisco-live.json', 'DOMAIN_NAME=Praetor', 'HEARTBEAT_INTERVAL_S=300']) expect(live).toContain(l);
    expect(live).not.toMatch(/[0-9a-fA-F]{40,}/);
  });

  it('is what make up LIVE=1 adds, without anvil', () => {
    const mk = read('Makefile');
    expect(mk).toContain('$(if $(LIVE),--env-file infra/live.env)');
    expect(mk).toMatch(/PROFILES := \$\(filter-out dev,\$\(PROFILES\)\)/);
  });
});
