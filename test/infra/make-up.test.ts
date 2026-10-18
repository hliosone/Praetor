// `make up` on a fresh clone (issue #11): the order of the steps, read from the Makefile and scripts/wecross/up.sh.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const mk = read('Makefile');
const recipe = (target: string) => mk.match(new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n)+)`, 'm'))?.[1] ?? '';

describe('make up on a fresh clone (issue #11)', () => {
  const up = recipe('up');
  const stack = recipe('up-stack');
  const base = recipe('up-base');

  it('makes the bind-mounted dirs as the user before compose can create them root-owned', () => {
    expect(up).toMatch(/mkdir -p apps\/web\/dist infra\/wecross\/generated/);
    expect(up.indexOf('mkdir -p')).toBeLessThan(up.indexOf('up-stack'));
    expect(read('infra/compose.yml')).toContain('../apps/web/dist:/srv/web:ro');
    expect(read('infra/compose.yml')).toContain('./wecross/generated:/data');
  });

  it('writes .run/compose.env, then runs the rest in a sub-make that reads it (ENV_FILES is expanded at parse time)', () => {
    expect(mk).toMatch(/\$\(if \$\(wildcard \.run\/compose\.env\),--env-file \.run\/compose\.env\)/);
    expect(up.indexOf('compose-env.sh')).toBeLessThan(up.indexOf('$(MAKE) --no-print-directory up-stack'));
    expect(stack).not.toContain('compose-env.sh');
  });

  it('starts and waits for the FISCO nodes in up-base, before ensure-fork-deploy deploys the consortium on them', () => {
    expect(base).toMatch(/up -d --wait[^\n]*\$\(FISCO_NODES\)/);
    expect(mk).toMatch(/^FISCO_NODES = fisco-node0 fisco-node1 fisco-node2 fisco-node3$/m);
    expect(stack.indexOf('up-base')).toBeLessThan(stack.indexOf('ensure-fork-deploy.sh'));
  });

  it('wires WeCross before waiting on health: the bridge-relayer is healthy only after scripts/wecross/up.sh', () => {
    const start = stack.indexOf('$(COMPOSE) $(PROFILE_FLAGS) up -d --build');
    const wire = stack.indexOf('bash scripts/wecross/up.sh');
    const wait = stack.lastIndexOf('$(COMPOSE) $(PROFILE_FLAGS) up -d --wait');
    expect(start).toBeGreaterThan(-1);
    expect(stack.slice(start, wire)).not.toContain('--wait');
    expect(wire).toBeGreaterThan(start);
    expect(wait).toBeGreaterThan(wire);
  });

  it('gives scripts/wecross/up.sh the full compose command, every profile included', () => {
    expect(stack).toContain('COMPOSE="$(COMPOSE) $(PROFILE_FLAGS)" bash scripts/wecross/up.sh');
    const sh = read('scripts/wecross/up.sh');
    const fallback = sh.match(/COMPOSE="\$\{COMPOSE:-([^}]*)\}"/)?.[1] ?? '';
    for (const p of ['core', 'chain', 'wecross']) expect(fallback).toContain(`--profile ${p}`);
  });

  it('recreates Caddy when the Caddyfile it sees is not the repo one (a single-file bind mount keeps the old inode)', () => {
    expect(base).toMatch(/exec -T caddy cat \/etc\/caddy\/Caddyfile \| cmp -s - infra\/Caddyfile \|\|[^\n]*--force-recreate caddy/);
  });
});
