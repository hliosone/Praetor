// `make up` on a fresh clone (issue #11): the main machine always had the FISCO nodes running, .run/compose.env
// written, the bind-mounted directories created and WeCross wired, so these steps are checked here by reading the
// Makefile and the scripts it calls.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

describe('make up on a fresh clone (#11)', () => {
  it('starts the four FISCO nodes with the base services, before the fork deploy bootstraps the consortium on them', () => {
    const base = recipe('up-base').find((l) => / up -d --wait /.test(l))!;
    expect(base).toContain('$(if $(filter chain,$(PROFILES)),--profile chain)');
    // PBFT seals with 3 of 4 sealers: every node, not only the one the deploy talks to.
    expect(base).toMatch(/\$\(if \$\(filter chain,\$\(PROFILES\)\),fisco-node0 fisco-node1 fisco-node2 fisco-node3\)/);
    const up = recipe('up');
    expect(indexOf(up, /up-base/)).toBeLessThan(indexOf(up, /ensure-fork-deploy\.sh/));
  });
});
