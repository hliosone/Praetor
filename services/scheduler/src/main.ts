// scheduler (spec 05): every PRICE_CHECK_INTERVAL_S, and at once on a DEMO price update, free reads of every
// registered account's weights; an asset outside its band with rebalances left today wakes its agent. Holds no key.
// Standing orders due (M10) and approval expiry (M9) join this loop with their milestones.
import pino from 'pino';
import express from 'express';
import { z } from 'zod';
import { erc20Abi, parseAbiItem, type Address } from 'viem';
import { MandateHookAbi, PriceOracleAbi, baseClients, loadDeployments } from '@praetor/chain';
import { PriceSource, type Policy } from '@praetor/protocol';
import { Cooldown, bandWake, weightsOf } from './bands.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  BUNDLER_URL: z.string().url().default('http://bundler:3010'),
  INTERNAL_TOKEN_BUNDLER: z.string().min(32),
  AGENT_RUNNER_URL: z.string().url().default('http://agent-runner:3100'),
  INTERNAL_TOKEN_AGENT: z.string().min(32),
  PRICE_CHECK_INTERVAL_S: z.coerce.number().int().min(5).default(900),
  WAKE_COOLDOWN_S: z.coerce.number().int().default(900),
  PORT: z.coerce.number().int().default(3110),
}).parse(process.env);

const log = pino();
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient: pub } = baseClients(env.BASE_RPC_URL);
const cooldown = new Cooldown(env.WAKE_COOLDOWN_S);
const symbols: Record<string, string> = { [d.usdc.toLowerCase()]: 'USDC', [d.txau.toLowerCase()]: 'tXAU', [d.txag.toLowerCase()]: 'tXAG' };
const UPDATED = parseAbiItem('event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)');
let lastCheck = 0;
let lastError = '';

async function accounts(): Promise<Address[]> {
  const r = await fetch(`${env.BUNDLER_URL}/accounts`, { headers: { authorization: `Bearer ${env.INTERNAL_TOKEN_BUNDLER}` } });
  if (!r.ok) throw new Error(`bundler accounts: ${r.status}`);
  return ((await r.json()) as { accounts: Address[] }).accounts;
}

async function checkAccount(account: Address) {
  const hook = { address: d.mandateHook, abi: MandateHookAbi } as const;
  const policy = (await pub.readContract({ ...hook, functionName: 'policyOf', args: [account] })) as unknown as Policy;
  if (policy.validUntil === 0n) return;
  const tokens = [d.usdc, d.txau, d.txag];
  const holdings = await Promise.all(tokens.map(async (t) => {
    const balance = await pub.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    const [price8] = (await pub.readContract({ address: d.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [t] })) as readonly [bigint, bigint];
    return { token: t, symbol: symbols[t.toLowerCase()]!, balance, decimals: t === d.usdc ? 6 : 18, price8 };
  }));
  const [, , , rebalances] = (await pub.readContract({ ...hook, functionName: 'spentOf', args: [account] })) as readonly [bigint, bigint, bigint, bigint];
  const wake = bandWake({
    weights: weightsOf(holdings), bands: policy.bands.map((b) => ({ ...b, token: b.token.toLowerCase() })), symbols,
    rebalancesToday: rebalances, maxRebalancesPerDay: policy.maxRebalancesPerDay,
  });
  if (!wake || !cooldown.take(account.toLowerCase(), Math.floor(Date.now() / 1000))) return;
  const r = await fetch(`${env.AGENT_RUNNER_URL}/wake`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_AGENT}` }, body: JSON.stringify({ account, ...wake }) });
  log.info({ account, status: r.status, weights: wake.context.weights }, 'agent woken (band)');
}

async function checkAll() {
  try {
    for (const a of await accounts()) await checkAccount(a).catch((e) => log.error({ account: a, error: (e as Error).message.split('\n')[0] }, 'check failed'));
    lastCheck = Date.now();
    lastError = '';
  } catch (e) {
    lastError = (e as Error).message.split('\n')[0]!;
    log.error({ error: lastError }, 'scheduler tick failed');
  }
}

// A DEMO price update (scripts/demo/shock.ts) triggers a check at once (F4 step 2).
let fromBlock = await pub.getBlockNumber();
async function watchDemo() {
  try {
    const head = await pub.getBlockNumber();
    if (head > fromBlock) {
      const logs = await pub.getLogs({ address: d.priceOracle, event: UPDATED, fromBlock: fromBlock + 1n, toBlock: head });
      fromBlock = head;
      if (logs.some((l) => Number(l.args.source) === PriceSource.DEMO)) await checkAll();
    }
  } catch (e) {
    log.error({ error: (e as Error).message.split('\n')[0] }, 'price watch failed');
  }
  setTimeout(watchDemo, 3000);
}

setInterval(() => void checkAll(), env.PRICE_CHECK_INTERVAL_S * 1000);
void checkAll();
void watchDemo();

const app = express();
app.get('/health', (_req, res) => {
  const fresh = Date.now() - lastCheck < 3 * env.PRICE_CHECK_INTERVAL_S * 1000;
  res.status(fresh ? 200 : 503).json({ ok: fresh, error: lastError || undefined });
});
app.listen(env.PORT, () => log.info({ port: env.PORT, intervalS: env.PRICE_CHECK_INTERVAL_S }, 'scheduler listening'));
