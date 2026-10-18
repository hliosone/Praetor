// oracle-feeder entrypoint: one tick per FEED_INTERVAL_S; GET /health reports the last tick.
import pino from 'pino';
import express from 'express';
import { z } from 'zod';
import { parseAbiItem, type Address, type Hex } from 'viem';
import { PriceOracleAbi, baseClients, baseNow, loadDeployments } from '@praetor/chain';
import { resolveKey } from '@praetor/config';
import { PriceSource } from '@praetor/protocol';
import { PYTH_IDS, SEEDED, decide, feedMode, normalisePyth, type Update } from './feeder.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  CHAIN_MODE: z.string().default('fork'),
  PYTH_API_KEY: z.string().default(''),
  PYTH_HERMES_URL: z.string().url().default('https://pyth.dourolabs.app/hermes'),
  DEMO_HOLD_S: z.coerce.number().int().default(600),
  FEED_INTERVAL_S: z.coerce.number().int().default(60),
  PORT: z.coerce.number().int().default(3070),
}).parse(process.env);

const log = pino();
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient, walletClient } = baseClients(env.BASE_RPC_URL, resolveKey('ORACLE_FEEDER_KEY', process.env));
const tokens: Record<keyof typeof PYTH_IDS, Address> = { XAU: d.txau, XAG: d.txag };
const UPDATED = parseAbiItem('event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)');
const LOOKBACK = 5_000n;
const mode = feedMode({ pythKey: env.PYTH_API_KEY, chainMode: env.CHAIN_MODE });
let lastTick = { at: 0, mode, error: '' };

async function lastUpdate(token: Address): Promise<Update | null> {
  const head = await publicClient.getBlockNumber();
  const back = head > LOOKBACK ? head - LOOKBACK : 0n;
  const fromBlock = back > BigInt(d.deployBlock) ? back : BigInt(d.deployBlock);
  const logs = await publicClient.getLogs({ address: d.priceOracle, event: UPDATED, args: { token }, fromBlock, toBlock: head });
  const l = logs.at(-1);
  if (l) return { price8: l.args.price8!, publishTime: BigInt(l.args.publishTime!), source: Number(l.args.source) };
  const [price8, publishTime] = (await publicClient.readContract({ address: d.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [token] })) as readonly [bigint, bigint];
  return price8 > 0n ? { price8, publishTime, source: PriceSource.PYTH } : null;
}

async function pythPrices(): Promise<Record<string, Update>> {
  const q = Object.values(PYTH_IDS).map((id) => `ids[]=${id}`).join('&');
  const r = await fetch(`${env.PYTH_HERMES_URL}/v2/updates/price/latest?${q}`, { headers: { authorization: `Bearer ${env.PYTH_API_KEY}` } });
  if (!r.ok) throw new Error(`Hermes ${r.status}`);
  const j = (await r.json()) as { parsed: { id: string; price: { price: string; expo: number; publish_time: number } }[] };
  const out: Record<string, Update> = {};
  for (const [asset, id] of Object.entries(PYTH_IDS)) {
    const p = j.parsed.find((x) => `0x${x.id.replace(/^0x/, '')}` === id);
    if (p) out[asset] = { price8: normalisePyth(p.price), publishTime: BigInt(p.price.publish_time), source: PriceSource.PYTH };
  }
  return out;
}

async function tick() {
  const now = await baseNow(publicClient);
  const next: Record<string, Update> = mode === 'pyth'
    ? await pythPrices()
    : Object.fromEntries(Object.entries(SEEDED).map(([a, p]) => [a, { price8: p, publishTime: now, source: PriceSource.DEMO }]));
  for (const [asset, token] of Object.entries(tokens)) {
    const n = next[asset];
    if (!n) continue;
    const u = decide({ now, last: await lastUpdate(token), next: n, holdS: BigInt(env.DEMO_HOLD_S) });
    if (!u) continue;
    const hash = await walletClient!.writeContract({ address: d.priceOracle, abi: PriceOracleAbi, functionName: 'setPrice', args: [token, u.price8, u.publishTime, u.source], account: walletClient!.account!, chain: walletClient!.chain });
    await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
    log.info({ asset, price8: u.price8.toString(), source: u.source }, 'price pushed');
  }
}

async function loop() {
  try {
    await tick();
    lastTick = { ...lastTick, at: Date.now(), error: '' };
  } catch (e) {
    lastTick = { ...lastTick, error: (e as Error).message.split('\n')[0]! };
    log.error({ error: lastTick.error }, 'tick failed');
  }
  setTimeout(loop, env.FEED_INTERVAL_S * 1000);
}

const app = express();
app.get('/health', (_req, res) => {
  const fresh = Date.now() - lastTick.at < 3 * env.FEED_INTERVAL_S * 1000;
  res.status(fresh ? 200 : 503).json({ ok: fresh, mode: lastTick.mode, error: lastTick.error || undefined });
});
app.listen(env.PORT, () => log.info({ port: env.PORT, mode: lastTick.mode }, 'oracle-feeder listening'));
void loop();
