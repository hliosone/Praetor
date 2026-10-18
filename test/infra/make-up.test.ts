// `make up` on a fresh clone (issue #11): the main machine always had the FISCO nodes running, .run/compose.env
// written, the bind-mounted directories created and WeCross wired, so these steps are checked here by reading the
// Makefile and the scripts it calls.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(root + p, 'utf8');
const mk = read('Makefile');

/** The recipe lines of a Makefile target, without their leading tab. */
function recipe(target: string): string[] {
  const m = new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n)*)`, 'm').exec(mk);
  expect(m, `target ${target}`).toBeTruthy();
  return m![1]!.split('\n').filter(Boolean).map((l) => l.slice(1));
}
const indexOf = (lines: string[], re: RegExp) => lines.findIndex((l) => re.test(l));
const compose = parse(read('infra/compose.yml'), { merge: true }) as { services: Record<string, { volumes?: string[] }> };

describe('make up on a fresh clone (#11)', () => {
  it('starts the four FISCO nodes with the base services, before the fork deploy bootstraps the consortium on them', () => {
    const base = recipe('up-base').find((l) => / up -d --wait /.test(l))!;
    expect(base).toContain('$(if $(filter chain,$(PROFILES)),--profile chain)');
    // PBFT seals with 3 of 4 sealers: every node, not only the one the deploy talks to.
    expect(base).toMatch(/\$\(if \$\(filter chain,\$\(PROFILES\)\),fisco-node0 fisco-node1 fisco-node2 fisco-node3\)/);
    const up = recipe('up');
    expect(indexOf(up, /up-base/)).toBeLessThan(indexOf(up, /ensure-fork-deploy\.sh/));
  });

  it('runs compose from sub-makes only, so every compose call reads the .run/compose.env that make up writes first', () => {
    // make expands all the lines of a recipe before it runs the first one: a $(COMPOSE) line in up itself is expanded
    // before compose-env.sh has run, and on a fresh clone it lacks --env-file .run/compose.env (every key blank).
    expect(mk).toContain('$(if $(wildcard .run/compose.env),--env-file .run/compose.env)');
    const up = recipe('up');
    expect(indexOf(up, /compose-env\.sh/)).toBeGreaterThanOrEqual(0);
    expect(up.filter((l) => l.includes('$(COMPOSE)'))).toEqual([]);
    expect(indexOf(up, /compose-env\.sh/)).toBeLessThan(indexOf(up, /\$\(MAKE\).* up-base$/));
    expect(indexOf(up, /compose-env\.sh/)).toBeLessThan(indexOf(up, /\$\(MAKE\).* up-services$/));
    expect(recipe('up-services').some((l) => l.includes('$(COMPOSE) $(PROFILE_FLAGS) up -d --wait --build'))).toBe(true);
  });

  it('creates every bind-mounted directory git does not hold, as the user, before compose runs', () => {
    // Docker creates a missing bind-mount source as root: vite then could not write apps/web/dist, nor wecross-setup
    // its /data. infra/fisco/nodes comes from infra/fisco/gen.sh, which make up also runs before compose.
    const up = recipe('up');
    const at = indexOf(up, /^mkdir -p /);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(indexOf(up, /\$\(MAKE\).* up-base$/));
    expect(at).toBeLessThan(indexOf(up, /pnpm .*@praetor\/web build/));
    const made = up[at]!.split(/\s+/).slice(2);
    const sources = new Set(Object.values(compose.services).flatMap((s) => s.volumes ?? []).map((v) => v.split(':')[0]!).filter((p) => p.startsWith('.')).map((p) => posix.normalize(`infra/${p}`)));
    expect([...sources]).toEqual(expect.arrayContaining(['apps/web/dist', 'infra/wecross/generated']));
    for (const p of sources) {
      if (p.startsWith('infra/fisco/nodes/')) continue;
      const tracked = execFileSync('git', ['ls-files', '--', p], { cwd: root, encoding: 'utf8' }).trim() !== '';
      expect(tracked || made.includes(p), p).toBe(true);
    }
    // A directory an earlier run left owned by root: stop with the fix instead of a vite EACCES later.
    expect(up[at + 1]).toMatch(/\[ -w "\$\$d" \]/);
  });

  it('wecross-setup says why it failed: an unwritable /data, else the failing line and the build tools\' output', () => {
    const sh = read('infra/wecross/entrypoint.sh');
    expect(sh).toMatch(/^\s+\[ -w \/data \] \|\| \{ echo "wecross: \/data \(infra\/wecross\/generated\) is not writable/m);
    // -E: the trap also fires inside setup(), a function. $BASH_COMMAND is the unexpanded text: no key in the log.
    expect(sh).toMatch(/^set -Eeuo pipefail$/m);
    expect(sh).toMatch(/^trap '[^']*\$LINENO: \$BASH_COMMAND[^']*tail -n 20 "\$LOG"[^']*' ERR$/m);
    expect(sh).not.toMatch(/^\s*set -[a-zA-Z]*x/m);
    // build_wecross.sh and add_chain.sh print their errors on stdout, which went to /dev/null.
    for (const tool of ['build_wecross.sh', 'add_chain.sh']) expect(sh).toMatch(new RegExp(`bash ${tool} [^\\n]*>>"\\$LOG"$`, 'm'));
  });
});
