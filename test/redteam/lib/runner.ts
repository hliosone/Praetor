// Runs one case: fixture, setup steps, snapshot, attack, snapshot again, judge. Effects are judged even when the
// executor failed half-way, so a harness error can never hide something that moved.
import { execFileSync } from 'node:child_process';
import { parseAbi, type Address } from 'viem';
import { bootstrapConsortium, ensureDeskLiquidity, root, waitFor, waitHeartbeat } from '../../../scripts/demo/lib.js';
import type { Case, Driver } from './case.js';
import { Chain } from './chain.js';
import { classify, type Observation } from './classify.js';
import { judgeEffects, type ChainState } from './effects.js';
import { makeStep, type Ctx, type Outcome, type Step } from './executors.js';
import { Fixtures, redteamStack, runTag } from './fixtures.js';
import type { CaseResult, RunFile } from './report.js';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 300);

export function createContext(driver: Driver): Ctx {
  const s = redteamStack();
  const chain = new Chain(s);
  return { s, chain, fixtures: new Fixtures(s, chain), driver, restores: [] };
}

/** What every flow test starts from (idempotent): consortium bootstrap, desk liquidity, a fresh heartbeat. */
export async function preflight(ctx: Ctx): Promise<void> {
  await bootstrapConsortium(ctx.s);
  await ensureDeskLiquidity(ctx.s);
  await waitHeartbeat(ctx.s);
}

/** Builds the fixtures the cases need, a few at a time; a fixture that fails turns its cases into ERROR. */
export async function prebuild(ctx: Ctx, cases: Case[], concurrency = Number(process.env.REDTEAM_CONCURRENCY ?? 3)): Promise<void> {
  const names = [...new Set(cases.map((c) => c.fixture).filter((f) => f !== 'fresh'))];
  // The web fixture is also account A of the cross-account MCP case.
  if (cases.some((c) => c.input.kind === 'custom' && c.input.name === 'mcp-cross-account') && !names.includes('web')) names.push('web');
  const queue = [...names];
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let n = queue.shift(); n; n = queue.shift()) await ctx.fixtures.get(n, ctx.driver, '').catch(() => undefined);
  }));
}

/** A case only proves something on a stack in its normal state: fresh heartbeat (else every T1 action reads
 *  STALE_STATUS) and, for swaps, fresh prices (else STALE_PRICE). Waits a little, then gives up (ERROR). */
async function preconditions(ctx: Ctx, c: Case): Promise<void> {
  const { chain, s } = ctx;
  const fresh = async () => (await chain.hook<readonly [number, number, number, bigint]>('statusOf', [s.base.usdc]))[3] > (await chain.now());
  if (!(await fresh())) await waitFor('fresh heartbeat before the attack', fresh, 240_000).catch(() => { throw new Error('heartbeat stale before the attack: the case would only show STALE_STATUS'); });
  if (/swap\(|praetor_rebalance/.test(JSON.stringify([c.setup, c.input]))) {
    const isFresh = (t: Address) => chain.p.readContract({ address: s.base.priceOracle, abi: parseAbi(['function isFresh(address) view returns (bool)']), functionName: 'isFresh', args: [t] });
    if (!(await isFresh(s.base.txau)) || !(await isFresh(s.base.txag))) throw new Error('metal prices are stale before the attack: the case would only show STALE_PRICE');
  }
}

export async function runCase(c: Case, ctx: Ctx): Promise<CaseResult> {
  const t0 = Date.now();
  const { chain, driver } = ctx;
  // The real model may pay an allowlisted payee on its own: for the live driver only outflows outside the mandate count.
  const forbid = driver === 'live' && c.forbid.outflow === 'any' ? { ...c.forbid, outflow: 'non-allowlisted' as const } : c.forbid;
  let account: Address | undefined;
  let before: ChainState | undefined;
  let from = 0n;
  let step: Step | undefined;
  let outcome: Outcome | undefined;
  let failure: string | undefined;
  let day0 = 0n;
  try {
    const fx = await ctx.fixtures.get(c.fixture, driver, c.id);
    account = fx.acc.address;
    await preconditions(ctx, c);
    day0 = (await chain.now()) / 86_400n;
    const vars = await ctx.fixtures.caseVars(fx, c);
    let since = await chain.block();
    const env = { ctx, fx, vars, c, since: () => since };
    for (const [k, input] of c.setup.entries()) {
      const st = makeStep(input, env);
      await st.prepare?.();
      const o = await st.run();
      if (!o.ok) throw new Error(`setup step ${k + 1} (${input.kind}) did not succeed: ${o.detail}`);
    }
    step = makeStep(c.input, env);
    await step.prepare?.();
    before = await chain.state(account);
    from = (await chain.block()) + 1n;
    since = from;
    outcome = await step.run();
  } catch (e) {
    failure = message(e);
  }

  let judged = { executed: false, effects: [] as string[] };
  if (account && before) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const to = await chain.block();
      const after = await chain.state(account);
      const policy = (await chain.hook<{ payees: readonly Address[]; hardCap: bigint }>('policyOf', [account]));
      const allow = { usdc: ctx.s.base.usdc, payees: [...policy.payees], desk: ctx.s.base.treasuryDesk, rail: ctx.s.base.payoutRail, hardCap: BigInt(policy.hardCap) };
      judged = judgeEffects({ account, before, after, transfers: from <= to ? await chain.transfers(account, from, to) : [], events: from <= to ? await chain.hookEvents(account, from, to) : [], forbid, allow });
    } catch (e) {
      failure = failure ?? `effects not judged: ${message(e)}`;
      outcome = undefined;
    }
  }
  await step?.cleanup?.().catch(() => undefined);

  // Daily budgets, counts and rebalances reset at a chain day boundary: an attack across one proves nothing.
  if (outcome && day0 && (await chain.now().catch(() => 0n)) / 86_400n !== day0) {
    failure = `the chain day changed between setup and attack (${judged.effects.join('; ') || 'nothing moved'}): run again`;
    outcome = undefined;
    judged = { executed: false, effects: [] };
  }
  const executed = judged.executed || outcome?.executed === true || outcome?.accepted === true;
  const effects = [...judged.effects, ...(outcome?.effects ?? []), ...(outcome?.accepted ? ['the stack accepted the attack request'] : [])];
  const observed: Observation = outcome
    ? { executed, layer: outcome.layer, reason: outcome.reason, tier: outcome.tier, error: outcome.error, detail: outcome.detail, txHashes: outcome.txHashes, effects }
    : { executed, layer: 'error', detail: failure ?? 'no outcome', txHashes: [], effects };
  return {
    id: c.id, category: c.category, item: c.item, title: c.title, heldout: c.heldout, driver, expect: c.expect, observed,
    verdict: classify(c.expect, observed, driver), foundry: c.foundry, ...(c.note ? { note: c.note } : {}), ms: Date.now() - t0,
  };
}

export function runFile(ctx: Ctx, driver: RunFile['driver'], startedAt: string, planned: number, results: CaseResult[]): RunFile {
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
  } catch {
    commit = undefined;
  }
  const b = ctx.s.base;
  return {
    driver, planned, startedAt, finishedAt: new Date().toISOString(), commit, ...(driver === 'live' ? { model: process.env.AGENT_MODEL ?? 'the stack default (AGENT_MODEL)' } : {}),
    stack: { chain: b.env, chainId: b.chainId, hook: b.mandateHook, domainName: b.domainName }, results: [...results].sort((x, y) => x.id.localeCompare(y.id)),
  };
}

export { runTag };
