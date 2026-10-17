import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

type Service = {
  image?: string;
  build?: unknown;
  profiles?: string[];
  ports?: string[];
  healthcheck?: unknown;
  command?: string | string[];
  labels?: Record<string, string>;
  restart?: string;
  depends_on?: Record<string, { condition?: string }>;
};
const compose = parse(read('infra/compose.yml'), { merge: true }) as {
  services: Record<string, Service>;
  networks: Record<string, { ipam?: { config?: { subnet: string }[] } }>;
};
const services = Object.entries(compose.services);

describe('infra/compose.yml', () => {
  it('gives every service a healthcheck and at least one profile', () => {
    for (const [name, s] of services) {
      if (s.labels?.['praetor.job'] !== 'oneshot') expect(s.healthcheck, `${name} healthcheck`).toBeTruthy();
      expect(s.profiles?.length, `${name} profiles`).toBeGreaterThan(0);
    }
  });

  it('one-shot jobs never restart, and the stack waits for their success (or they are on-demand tools)', () => {
    for (const [name, s] of services) {
      if (s.labels?.['praetor.job'] !== 'oneshot') continue;
      expect(s.restart, `${name} restart`).toBeUndefined();
      if (s.profiles?.includes('tools')) continue;
      const waiters = services.filter(([, o]) => o.depends_on?.[name]?.condition === 'service_completed_successfully');
      expect(waiters.length, `${name} waiters`).toBeGreaterThan(0);
    }
  });

  it('pins every pulled image by digest', () => {
    for (const [name, s] of services) if (!s.build) expect(s.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('publishes ports only from caddy (80/443) and anvil on loopback 18545 (spec 11)', () => {
    for (const [name, s] of services) {
      const ports = s.ports ?? [];
      if (name === 'caddy') expect(ports.sort()).toEqual(['443:443', '80:80']);
      else if (name === 'anvil') expect(ports).toEqual(['127.0.0.1:18545:8545']);
      else expect(ports, name).toEqual([]);
    }
  });

  it('runs on the 10.88.0.0/16 network (Q9)', () => {
    expect(compose.networks.praetor?.ipam?.config?.[0]?.subnet).toBe('10.88.0.0/16');
  });

  it('forks Base Sepolia at the pinned block with the P-256 precompile (Q6, Q7)', () => {
    const cmd = [compose.services.anvil?.command].flat().join(' ');
    for (const flag of ['--fork-url', '--fork-block-number ${FORK_BLOCK}', '--chain-id 84532', '--network optimism'])
      expect(cmd).toContain(flag);
    const fork = JSON.parse(read('infra/deployments/fork.json')) as { forkBlock: number };
    expect(read('infra/.env.example')).toMatch(new RegExp(`^FORK_BLOCK=${fork.forkBlock}$`, 'm'));
  });

  it('documents in infra/.env.example every variable compose interpolates', () => {
    const vars = new Set([...read('infra/compose.yml').matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]!));
    const example = read('infra/.env.example');
    for (const v of vars) expect(example, v).toMatch(new RegExp(`^${v}=`, 'm'));
  });

  it('creates one database and one user per service in MySQL', () => {
    const init = read('infra/mysql/init/01-databases.sh');
    for (const s of ['api', 'mcp', 'bank', 'regulator', 'operator', 'payout', 'weid', 'webase', 'wecross', 'bundler']) {
      expect(init).toContain(`create_db ${s} `);
    }
  });
});

describe('FISCO BCOS nodes (spec 04, V2)', () => {
  it('runs four sealers from our own image on fixed IPs, profile chain, no published port', () => {
    for (let i = 0; i < 4; i++) {
      const s = compose.services[`fisco-node${i}`];
      expect(s, `fisco-node${i}`).toBeDefined();
      expect(s!.build ?? s!.image).toBeTruthy();
      expect(s!.profiles).toContain('chain');
      expect(s!.ports ?? []).toEqual([]);
      expect(JSON.stringify(s)).toContain(`10.88.1.1${i}`);
    }
  });

  it('pins the release binary and build_chain.sh by sha256', () => {
    const fetch = read('infra/fisco/fetch.sh');
    expect(fetch).toContain('28eb054bb222b805e116bf7d2462709f99d1f460a732e978555abe61973b3cbb');
    expect(fetch).toContain('ed667e1e346acbe2fea7b667856ddf05af9e4892ac0424ff9f703f0ea601dbe7');
  });
});
