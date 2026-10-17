// Shared body of the three red-team entry points (suite/*.test.ts): cases, fixtures, one test per case, the run file
// and the report written in afterAll even when cases fail.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { root } from '../../../scripts/demo/lib.js';
import { BUILTIN } from '../cases/index.js';
import { loadHeldout, type Case, type Driver } from './case.js';
import { createContext, prebuild, preflight, runCase, runFile } from './runner.js';
import { headline, readRuns, renderReport, writeRun, type CaseResult, type RunFile } from './report.js';
import type { Verdict } from './classify.js';

export function heldout(builtinIds: string[]): Case[] {
  const dir = process.env.REDTEAM_HELDOUT_DIR;
  return dir ? loadHeldout(dir, builtinIds) : [];
}

/** REDTEAM_ONLY=RT-01,RT-02 runs a subset (debugging); the report then covers that subset only. */
const only = (cases: Case[]) => {
  const ids = process.env.REDTEAM_ONLY?.split(',').map((x) => x.trim()).filter(Boolean);
  return ids?.length ? cases.filter((c) => ids.includes(c.id)) : cases;
};

export function redteamSuite(o: { name: RunFile['driver']; driver: Driver; cases: Case[]; pass: Verdict[]; afterRun?: (ctx: ReturnType<typeof createContext>) => Promise<void> }) {
  const all = only([...o.cases, ...heldout([...BUILTIN, ...o.cases].map((c) => c.id))]).filter((c) => c.drivers.includes(o.driver));
  const ctx = createContext(o.driver);
  const results: CaseResult[] = [];
  const startedAt = new Date().toISOString();

  beforeAll(async () => {
    await preflight(ctx);
    await prebuild(ctx, all);
  }, 3_600_000);

  afterAll(async () => {
    try {
      await o.afterRun?.(ctx);
    } finally {
      mkdirSync(`${root}.run`, { recursive: true });
      // A REDTEAM_ONLY subset never replaces the full run behind the report.
      const partial = !!process.env.REDTEAM_ONLY;
      writeRun(`${root}.run/redteam-${o.name}${partial ? '-partial' : ''}.json`, runFile(ctx, o.name, startedAt, results));
      if (!partial) writeFileSync(`${root}docs/security/redteam.md`, renderReport(readRuns(`${root}.run`)));
    }
  }, 1_200_000);

  describe(`red team (${o.name})`, () => {
    for (const c of all) {
      it(`${c.id} [item ${c.item}] ${c.title}`, async () => {
        const r = await runCase(c, ctx);
        results.push(r);
        expect(r.verdict, `${r.observed.layer} ${r.observed.reason ?? ''} ${r.observed.tier ?? ''} ${r.observed.error ?? ''}: ${r.observed.detail}`).toBeOneOf(o.pass);
      }, 900_000);
    }

    it('headline: N attacks, 0 executed', () => {
      const executed = results.filter((r) => r.verdict === 'EXECUTED');
      console.log(`red team (${o.name}): ${headline(results)}`);
      expect(executed.map((r) => `${r.id}: ${r.observed.effects.join('; ')}`)).toEqual([]);
    });
  });
}
