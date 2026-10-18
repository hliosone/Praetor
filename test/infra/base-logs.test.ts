import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// D98: public Base RPCs refuse wide eth_getLogs (publicnode 50,000 blocks, sepolia.base.org 200) and several services
// read from the deployment block, so every Base log query goes through @praetor/chain's boundedGetLogs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|mts|js|mjs)$/.test(name) ? [p] : [];
  });
}

const dirs = (parent: string) => readdirSync(root + parent).map((n) => `${parent}/${n}/src`);
const files = [...dirs('services'), ...dirs('packages'), 'scripts'].flatMap((d) => sources(root + d)).map((p) => relative(root, p));
// The helper itself, and FISCO's own 10-block windows (Q23): not Base.
const ALLOWED = new Set(['packages/chain/src/logs.ts', 'packages/fisco-client/src/client.ts']);
const RAW = /\.getLogs\(|getContractEvents|getFilterLogs|createEventFilter|createContractEventFilter|watchContractEvent|watchEvent\(|eth_getLogs/;

describe('Base log queries are bounded (D98)', () => {
  it('sends every Base log query in services, packages and scripts through boundedGetLogs', () => {
    expect(files.length).toBeGreaterThan(50);
    const raw = files.filter((f) => !ALLOWED.has(f)).flatMap((f) =>
      read(f).split('\n').flatMap((line, i) => (RAW.test(line) ? [`${f}:${i + 1}`] : [])));
    expect(raw).toEqual([]);
  });

  it('passes BASE_LOGS_MAX_RANGE to every service that reads Base logs, and documents it', () => {
    const compose = parse(read('infra/compose.yml'), { merge: true }) as { services: Record<string, { environment?: Record<string, string> }> };
    const readers = readdirSync(root + 'services').filter((s) =>
      sources(root + `services/${s}/src`).some((f) => /boundedGetLogs\(|accountReader\(|chainReader\(/.test(readFileSync(f, 'utf8'))));
    expect(readers.sort()).toEqual(expect.arrayContaining(['api', 'mcp', 'notifier', 'operator', 'oracle-feeder', 'payout-partner', 'scheduler']));
    for (const s of readers) expect(compose.services[s]?.environment?.BASE_LOGS_MAX_RANGE, s).toBe('${BASE_LOGS_MAX_RANGE}');
    expect(read('infra/.env.example')).toMatch(/^BASE_LOGS_MAX_RANGE=10000$/m);
    expect(read('infra/live.env')).toMatch(/^BASE_LOGS_MAX_RANGE=10000$/m);
  });
});
