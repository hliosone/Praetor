import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// The Guomi profile smoke (M15, spec 04): a disposable SM chain fully separate from the local stack.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

type Service = { image?: string; pull_policy?: string; user?: string; ports?: string[]; healthcheck?: unknown; volumes?: string[]; networks?: Record<string, { ipv4_address?: string }> };
type Compose = { name?: string; services: Record<string, Service>; networks: Record<string, { ipam?: { config?: { subnet: string }[] } }> };
const sm = parse(read('infra/fisco/sm/compose.yml'), { merge: true }) as Compose;
const main = parse(read('infra/compose.yml'), { merge: true }) as Compose;

const toInt = (ip: string) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const range = (cidr: string) => {
  const [ip, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  const start = toInt(ip!) - (toInt(ip!) % size);
  return [start, start + size - 1] as const;
};
const overlaps = (a: string, b: string) => {
  const [a0, a1] = range(a);
  const [b0, b1] = range(b);
  return a0 <= b1 && b0 <= a1;
};

describe('infra/fisco/sm/compose.yml (Guomi smoke chain)', () => {
  const subnets = Object.values(sm.networks).map((n) => n.ipam?.config?.[0]?.subnet);

  it('is its own compose project, never the local stack', () => {
    expect(sm.name).toBe('praetor-sm');
    expect(Object.keys(sm.services).every((n) => !Object.keys(main.services).includes(n))).toBe(true);
  });

  it('uses one private network that overlaps none of the stack networks', () => {
    expect(subnets).toEqual(['10.97.0.0/24']);
    for (const n of Object.values(main.networks)) expect(overlaps('10.97.0.0/24', n.ipam!.config![0]!.subnet)).toBe(false);
  });

  it('runs four sealers from the stack image on fixed IPs, as the invoking user, with no published port', () => {
    const nodes = Object.entries(sm.services);
    expect(nodes.map(([n]) => n)).toEqual(['fisco-sm-node0', 'fisco-sm-node1', 'fisco-sm-node2', 'fisco-sm-node3']);
    nodes.forEach(([name, s], i) => {
      expect(s.image, name).toBe('praetor/fisco-bcos:3.17.1');
      expect(s.pull_policy, name).toBe('never');
      // The chain is regenerated on every run: files the node writes must stay removable without root.
      expect(s.user, name).toBe('${SM_UID}:${SM_GID}');
      expect(s.ports ?? [], name).toEqual([]);
      expect(s.healthcheck, name).toBeTruthy();
      expect(Object.values(s.networks!)[0]!.ipv4_address, name).toBe(`10.97.0.1${i}`);
      expect(s.volumes, name).toEqual([`\${SM_CHAIN}/10.97.0.1${i}/node0:/data`]);
    });
  });
});

describe('FISCO tooling keeps the main profile as it was', () => {
  it('generates the stack chain on 10.88.1.10-13 unless told otherwise, and needs an explicit SM2 admin for SM', () => {
    const gen = read('infra/fisco/gen.sh');
    expect(gen).toContain('${FISCO_IPS:-10.88.1.10:1,10.88.1.11:1,10.88.1.12:1,10.88.1.13:1}');
    expect(gen).toMatch(/SM=1 needs ADMIN/);
  });

  it('deploys WeIdentity with sm_crypto=0 and the ECDSA SDK certificates unless WEID_SM=1', () => {
    const deploy = read('infra/weid/deploy.sh');
    expect(deploy).toContain('sm_crypto="${WEID_SM:-0}"');
    expect(deploy).toContain('certs=(ca.crt sdk.crt sdk.key)');
    expect(deploy).toMatch(/^sm_crypto=\$\{sm_crypto\}$/m);
  });

  it('pins the console (Java SDK 3.8.0 and the SM solc) by sha256, fetched only on request', () => {
    const fetch = read('infra/fisco/fetch.sh');
    expect(fetch).toContain('255f1b67b22f0672612e41f93e816c2ba53a9dd3684ccc2a64c75e1b02fb6d1a');
    expect(fetch).toMatch(/"\$\{1:-\}" = console/);
  });
});
