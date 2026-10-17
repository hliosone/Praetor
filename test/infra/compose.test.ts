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
};
const compose = parse(read('infra/compose.yml')) as {
  services: Record<string, Service>;
  networks: Record<string, { ipam?: { config?: { subnet: string }[] } }>;
};
const services = Object.entries(compose.services);

describe('infra/compose.yml', () => {
  it('gives every service a healthcheck and at least one profile', () => {
    for (const [name, s] of services) {
      expect(s.healthcheck, `${name} healthcheck`).toBeTruthy();
      expect(s.profiles?.length, `${name} profiles`).toBeGreaterThan(0);
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
    for (const s of ['api', 'mcp', 'bank', 'regulator', 'operator', 'payout', 'weid', 'webase', 'wecross']) {
      expect(init).toContain(`create_db ${s} `);
    }
  });
});
