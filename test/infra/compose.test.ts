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
  pull_policy?: string;
  restart?: string;
  volumes?: string[];
  depends_on?: Record<string, { condition?: string }>;
  networks?: string[] | Record<string, unknown>;
  environment?: Record<string, string>;
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

  it('pins every pulled image by digest (locally built ones are never pulled)', () => {
    for (const [name, s] of services) {
      if (s.build) continue;
      if (s.pull_policy === 'never') expect(s.image, name).toMatch(/^praetor\//);
      else expect(s.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
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

  it('isolates the agent: agent-runner only on the agent network, without the keys or tokens of other services', () => {
    const on = (s: Service, n: string) => (Array.isArray(s.networks) ? s.networks.includes(n) : Object.keys(s.networks ?? {}).includes(n));
    expect(compose.networks.agent?.ipam?.config?.[0]?.subnet).toBe('10.90.0.0/24');
    const runner = compose.services['agent-runner']!;
    expect(Object.keys(runner.networks as Record<string, unknown>)).toEqual(['agent']);
    const forbidden = /^(SIGNER_HMAC|ATTESTER_HMAC|INTERNAL_TOKEN_(BUNDLER|MEMBERS|API)|KYC_|MYSQL_|SESSION_SECRET|.*_KEY$)/;
    // OPENCODE_API_KEY is the model provider's credential, the one key the agent needs.
    expect(Object.keys(runner.environment ?? {}).filter((k) => forbidden.test(k) && k !== 'OPENCODE_API_KEY')).toEqual([]);
    expect(Object.keys(compose.services['fake-llm']!.networks as Record<string, unknown>)).toEqual(['agent']);
    const members = services.filter(([, s]) => on(s, 'agent')).map(([n]) => n).sort();
    expect(members).toEqual(['agent-runner', 'api', 'fake-llm', 'mcp', 'scheduler']);
    // mcp takes an agent bearer only from agent-runner's address: the agent network also holds the host's gateway.
    const runnerIp = (runner.networks as Record<string, { ipv4_address: string }>).agent!.ipv4_address;
    expect(compose.services.mcp!.environment!.AGENT_SUBNET).toBe(`${runnerIp}/32`);
    expect(read('services/mcp/src/main.ts')).toContain(`AGENT_SUBNET: z.string().default('${runnerIp}/32')`);
  });

  it('services that show transaction links know the chain mode: no BaseScan link for a fork transaction (#9)', () => {
    for (const s of ['api']) {
      expect(compose.services[s]!.environment!.CHAIN_MODE, s).toBe('${CHAIN_MODE}');
      expect(read(`services/${s}/src/main.ts`), s).toMatch(/explorerUrl\(env\)/);
    }
  });

  it('keeps the custodial WeIdentity services on their own network, joined only by bank, MySQL and one FISCO node', () => {
    // weid-rest and weid-helper hold every hosted key with no auth (spec 05): nothing agent-side may reach them.
    const on = (s: Service, n: string) => (Array.isArray(s.networks) ? s.networks.includes(n) : Object.keys(s.networks ?? {}).includes(n));
    expect(compose.networks.identity?.ipam?.config?.[0]?.subnet).toBe('10.89.0.0/24');
    const members = services.filter(([, s]) => on(s, 'identity')).map(([n]) => n).sort();
    expect(members).toEqual(['bank', 'fisco-node0', 'mysql', 'weid-deploy', 'weid-helper', 'weid-rest', 'weid-scenario']);
    for (const [name, s] of services) if (name.startsWith('weid-')) expect(on(s, 'praetor'), name).toBe(false);
  });

  it('forks Base Sepolia at the pinned block with the P-256 precompile (Q6, Q7)', () => {
    const cmd = [compose.services.anvil?.command].flat().join(' ');
    for (const flag of ['--fork-url', '--fork-block-number ${FORK_BLOCK}', '--chain-id 84532', '--network optimism'])
      expect(cmd).toContain(flag);
    const fork = JSON.parse(read('infra/deployments/fork.json')) as { forkBlock: number };
    expect(read('infra/.env.example')).toMatch(new RegExp(`^FORK_BLOCK=${fork.forkBlock}$`, 'm'));
  });

  it('survives a blip of the public RPC it forks: retries with backoff, keeps its state on a volume, restarts', () => {
    const a = compose.services.anvil!;
    const cmd = [a.command].flat().join(' ');
    for (const flag of ['--retries', '--fork-retry-backoff', '--state /home/foundry/fork.json', '--state-interval']) expect(cmd).toContain(flag);
    expect(a.restart).toBe('unless-stopped');
    expect(a.volumes).toContain('anvil-state:/home/foundry');
    expect(read('Makefile')).toMatch(/^reset-fork:[\s\S]*?volume rm[^\n]*anvil-state/m);
  });

  it('runs the payout partner with the PSP mocks (mocks profile); the Alipay+ mock serves 443 inside the network only (V7)', () => {
    const c = compose.services;
    for (const n of ['alipayplus-mock', 'wechatpay-mock', 'payout-partner']) expect(c[n]?.profiles).toEqual(['mocks']);
    expect(c['alipayplus-mock']!.ports).toBeUndefined();
    expect(c['payout-partner']!.environment).toMatchObject({ ALIPAYPLUS_GATEWAY_URL: 'https://alipayplus-mock', WECHATPAY_URL: 'http://wechatpay-mock:3300' });
    // The partner holds its own Base key and the merchant's Alipay+ key, never the gateway's private key.
    expect(Object.keys(c['payout-partner']!.environment!)).not.toContain('ALIPAYPLUS_TEST_GATEWAY_PRIVATE_KEY');
    expect(Object.keys(c['alipayplus-mock']!.environment!)).not.toContain('ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY');
  });

  it('recreates caddy when the Caddyfile changes: a single-file mount keeps the old file once git replaces it (red team D62)', () => {
    expect(compose.services.caddy!.labels).toEqual({ 'praetor.caddyfile-sha': '${CADDYFILE_SHA}' });
    expect(read('scripts/dev/compose-env.sh')).toMatch(/CADDYFILE_SHA=.*sha256sum infra\/Caddyfile/);
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
