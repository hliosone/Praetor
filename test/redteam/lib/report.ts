// Report writer: each run leaves .run/redteam-<driver>.json (read later by scripts/evidence), and
// docs/security/redteam.md is rendered from every run file present, headline first ("N attacks, 0 executed", spec 08).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from 'viem';
import { CATEGORIES, type Category, type Driver, type Expectation } from './case.js';
import type { Observation, Verdict } from './classify.js';

export type CaseResult = {
  id: string; category: Category; item: number; title: string; heldout: boolean; driver: Driver;
  expect: Expectation; observed: Observation; verdict: Verdict; foundry: string[]; note?: string; ms: number;
};

export type RunFile = {
  driver: Driver | 'global';
  startedAt: string;
  finishedAt: string;
  commit?: string;
  model?: string;
  stack: { chain: string; chainId: number; hook: Address; domainName: string };
  results: CaseResult[];
};

const ORDER: RunFile['driver'][] = ['scripted', 'global', 'live'];
const TITLES: Record<RunFile['driver'], string> = { scripted: 'Scripted run (CI driver)', global: 'Global run (REDTEAM_GLOBAL=1)', live: 'Live run (real model)' };

export function summarize(results: CaseResult[]) {
  const n = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  return { attacks: results.length, executed: n('EXECUTED'), blocked: n('BLOCKED'), elsewhere: n('BLOCKED_ELSEWHERE'), declined: n('NOT_ATTEMPTED'), errors: n('ERROR') };
}

export const headline = (results: CaseResult[]) => `${results.length} attacks, ${summarize(results).executed} executed`;

const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const outcome = (o: { layer: string; reason?: string; tier?: string; error?: string }) => [o.layer, o.reason, o.tier, o.error].filter(Boolean).join(' ');

function evidence(r: CaseResult): string {
  const parts = [r.observed.detail, ...r.observed.txHashes];
  if (r.foundry.length) parts.push(`Foundry: ${r.foundry.join(', ')}`);
  if (r.note) parts.push(r.note);
  return parts.filter(Boolean).join('; ');
}

function table(results: CaseResult[]): string[] {
  const rows = [...results].sort((a, b) => a.item - b.item || a.id.localeCompare(b.id));
  return [
    '| ID | Item | Attack | Expected | Observed | Verdict | Evidence |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.id)} | ${r.item} | ${cell(r.title)} | ${cell(outcome(r.expect))} | ${cell(outcome(r.observed))} | ${r.verdict} | ${cell(evidence(r))} |`),
  ];
}

export function renderReport(runs: RunFile[]): string {
  const out = [
    '# Red-team results',
    '',
    'Generated from `.run/redteam-*.json` by the red-team suite (`test/redteam`, `make redteam`, `make redteam-live`); do not edit by hand.',
    'Each case is one attack of spec 08 against the running stack. **Executed** means a value or a permission moved that the mandate does not allow,',
    'judged from token transfers and protected state read on-chain before and after the attack (never from what a tool or the model said).',
    '',
  ];
  if (runs.length === 0) return [...out, 'No run yet: start the stack (`make up`) and run `make redteam`.', ''].join('\n');

  out.push('## Headline', '', '| Run | Finished | Headline | Blocked as expected | Blocked elsewhere | Model declined | Errors |', '|---|---|---|---|---|---|---|');
  for (const r of runs) {
    const s = summarize(r.results);
    out.push(`| ${TITLES[r.driver]} | ${r.finishedAt} | **${headline(r.results)}** | ${s.blocked} | ${s.elsewhere} | ${s.declined} | ${s.errors} |`);
  }
  out.push('');

  const executed = runs.flatMap((r) => r.results.filter((x) => x.verdict === 'EXECUTED'));
  if (executed.length) {
    out.push('## Executed attacks', '', 'Each of these moved something the mandate does not allow: a vulnerability to fix before release.', '');
    for (const x of executed) out.push(`- **${x.id}** (${x.driver}) ${cell(x.title)}: ${x.observed.effects.join('; ')}`);
    out.push('');
  }

  const main = runs.find((r) => r.driver === 'scripted') ?? runs[0]!;
  out.push('## Cases per category', '', `From the ${main.driver} run.`, '', '| Item | Category | Cases | Held out | Executed |', '|---|---|---|---|---|');
  CATEGORIES.forEach((c, i) => {
    const rs = main.results.filter((r) => r.category === c);
    if (rs.length) out.push(`| ${i + 1} | ${c} | ${rs.length} | ${rs.filter((r) => r.heldout).length} | ${rs.filter((r) => r.verdict === 'EXECUTED').length} |`);
  });
  out.push('');

  for (const r of runs) {
    out.push(`## ${TITLES[r.driver]}`, '');
    out.push(`Stack: ${r.stack.chain} (chain ${r.stack.chainId}), MandateHook ${r.stack.hook}, EIP-712 domain "${r.stack.domainName}"${r.model ? `, model ${r.model}` : ''}; commit ${r.commit ?? 'unknown'}; ${r.startedAt} to ${r.finishedAt}.`, '');
    out.push(`**${headline(r.results)}**`, '');
    const builtin = r.results.filter((x) => !x.heldout);
    const held = r.results.filter((x) => x.heldout);
    if (builtin.length) out.push(...table(builtin), '');
    if (held.length) out.push('### Held-out cases', '', `${held.length} cases written outside the repo (REDTEAM_HELDOUT_DIR).`, '', ...table(held), '');
  }

  const contract = main.results.filter((r) => r.foundry.length);
  if (contract.length) {
    out.push('## Defences also shown at the contract level', '', 'Where a layer in front stops an attack before it reaches a contract (for example agent-signer refusing to sign), the Foundry test proves the contract would refuse it too.', '');
    for (const r of contract) out.push(`- ${r.id}: ${r.foundry.join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

export function writeRun(path: string, run: RunFile): void {
  writeFileSync(path, `${JSON.stringify(run, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}\n`);
}

/** Every `redteam-<driver>.json` of a directory, in the order scripted, global, live. */
export function readRuns(dir: string): RunFile[] {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir)
    .filter((n) => /^redteam-(scripted|global|live)\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as RunFile);
  return runs.sort((a, b) => ORDER.indexOf(a.driver) - ORDER.indexOf(b.driver));
}
