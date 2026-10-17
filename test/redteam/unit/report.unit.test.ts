// The report writer: docs/security/redteam.md and the JSON results under .run/ come from a run, with the headline
// "N attacks, 0 executed" (spec 08), never written by hand.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { headline, renderReport, readRuns, summarize, type CaseResult, type RunFile } from '../lib/report.js';

const tx = `0x${'ab'.repeat(32)}` as const;
const result = (o: Partial<CaseResult>): CaseResult => ({
  id: 'RT-01', category: 'prompt-injection', item: 1, title: 'Chat injection', heldout: false, driver: 'scripted',
  expect: { layer: 'hook', reason: 'SANCTIONED', tier: 'T0_NEVER' },
  observed: { executed: false, layer: 'hook', reason: 'SANCTIONED', tier: 'T0_NEVER', detail: 'refused on-chain', txHashes: [tx], effects: [] },
  verdict: 'BLOCKED', foundry: [], ms: 1200, ...o,
});
const run = (results: CaseResult[], driver: RunFile['driver'] = 'scripted', planned = results.length): RunFile => ({
  driver, planned, startedAt: '2026-10-17T20:00:00.000Z', finishedAt: '2026-10-17T20:30:00.000Z', commit: 'abc1234', stack: { chain: 'fork', chainId: 84532, hook: '0x00000000000000000000000000000000000000aa', domainName: 'Praetor-local' }, results,
});

describe('headline and summary', () => {
  it('counts attacks and executed attacks', () => {
    expect(headline([result({}), result({ id: 'RT-02' })])).toBe('2 attacks, 0 executed');
    expect(headline([result({}), result({ id: 'RT-02', verdict: 'EXECUTED' })])).toBe('2 attacks, 1 executed');
  });

  it('summarizes verdicts per run', () => {
    const s = summarize([result({}), result({ id: 'b', verdict: 'BLOCKED_ELSEWHERE' }), result({ id: 'c', verdict: 'NOT_ATTEMPTED' }), result({ id: 'd', verdict: 'ERROR' })]);
    expect(s).toEqual({ attacks: 4, executed: 0, blocked: 1, elsewhere: 1, declined: 1, errors: 1 });
  });
});

describe('renderReport', () => {
  it('puts the headline of each run first, then one row per case with expected, observed, verdict and transactions', () => {
    const md = renderReport([run([result({}), result({ id: 'RT-02', title: 'Over | hard cap', category: 'limits', item: 2 })])]);
    expect(md).toMatch(/^# Red-team results/);
    expect(md).toContain('**2 attacks, 0 executed**');
    expect(md).toContain('| RT-01 | 1 | Chat injection | hook SANCTIONED T0_NEVER | hook SANCTIONED T0_NEVER | BLOCKED |');
    expect(md).toContain('Over \\| hard cap');
    expect(md).toContain(tx);
  });

  it('lists executed attacks in their own section, with what moved', () => {
    const md = renderReport([run([result({ verdict: 'EXECUTED', observed: { executed: true, layer: 'hook', detail: 'paid', txHashes: [tx], effects: ['5 of token 0x1 left the account'] } })])]);
    expect(md).toContain('**1 attacks, 1 executed**');
    expect(md).toMatch(/## Executed attacks[\s\S]*RT-01[\s\S]*left the account/);
  });

  it('keeps held-out cases apart, shows the live run, and names the Foundry tests of contract-level defences', () => {
    const md = renderReport([
      run([result({}), result({ id: 'HO-01', heldout: true }), result({ id: 'RT-05', foundry: ['contracts/base/test/unit/X.t.sol::test_y'] })]),
      run([result({ driver: 'live', verdict: 'NOT_ATTEMPTED', observed: { executed: false, layer: 'model', detail: 'declined', txHashes: [], effects: [] } })], 'live'),
    ]);
    expect(md).toMatch(/Held-out cases[\s\S]*HO-01/);
    expect(md).toMatch(/## Live run/);
    expect(md).toContain('contracts/base/test/unit/X.t.sol::test_y');
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });

  it('a run that did not reach every planned case is marked incomplete, never given a clean headline', () => {
    const md = renderReport([run([result({})], 'scripted', 83)]);
    expect(md).toContain('INCOMPLETE: 1 of 83 planned cases ran');
    expect(md).not.toContain('**1 attacks, 0 executed**');
    expect(renderReport([run([], 'scripted', 83)])).toContain('INCOMPLETE: 0 of 83 planned cases ran');
  });

  it('says so when no run exists yet', () => {
    expect(renderReport([])).toMatch(/No run yet/);
  });
});

describe('readRuns', () => {
  it('reads .run/redteam-*.json in the order scripted, global, live, ignoring other files', () => {
    const d = mkdtempSync(join(tmpdir(), 'redteam-runs-'));
    writeFileSync(join(d, 'redteam-live.json'), JSON.stringify(run([], 'live')));
    writeFileSync(join(d, 'redteam-scripted.json'), JSON.stringify(run([])));
    writeFileSync(join(d, 'redteam-global.json'), JSON.stringify(run([], 'global')));
    writeFileSync(join(d, 'seed.json'), '{}');
    expect(readRuns(d).map((r) => r.driver)).toEqual(['scripted', 'global', 'live']);
  });
});
