// The scheduler's free check (spec 05, F4 step 2): portfolio weights at oracle prices against the mandate's bands.

export type Holding = { token: string; symbol: string; balance: bigint; decimals: number; price8: bigint };
export type Band = { token: string; minBps: number; targetBps: number; maxBps: number };

/** Rounding at a band edge is not a breach: Lin's starting tXAG sits exactly at its 15% max (spec 00). */
export const BAND_TOLERANCE_BPS = 10;

export function weightsOf(h: Holding[]): Record<string, number> {
  const values = h.map((x) => ({ symbol: x.symbol, v: (x.balance * x.price8) / 10n ** BigInt(x.decimals + 2) }));
  const total = values.reduce((s, x) => s + x.v, 0n);
  return Object.fromEntries(values.map((x) => [x.symbol, total > 0n ? Number((x.v * 10_000n) / total) : 0]));
}

function outside(weights: Record<string, number>, bands: Band[], symbols: Record<string, string>) {
  return bands
    .map((b) => ({ symbol: symbols[b.token] ?? b.token, w: weights[symbols[b.token] ?? ''] ?? 0, b }))
    .filter((x) => x.w < x.b.minBps - BAND_TOLERANCE_BPS || x.w > x.b.maxBps + BAND_TOLERANCE_BPS);
}

/** The assets outside their bands with their weights in whole percent: a new price move gives a new signature. */
export function breachSignature(weights: Record<string, number>, bands: Band[], symbols: Record<string, string>): string {
  return outside(weights, bands, symbols).map((x) => `${x.symbol}:${Math.floor(x.w / 100)}`).sort().join(',');
}

export function bandWake(a: { weights: Record<string, number>; bands: Band[]; symbols: Record<string, string>; rebalancesToday: bigint; maxRebalancesPerDay: number }) {
  if (a.rebalancesToday >= BigInt(a.maxRebalancesPerDay)) return null;
  if (Object.values(a.weights).every((w) => w === 0)) return null;
  if (outside(a.weights, a.bands, a.symbols).length === 0) return null;
  const bands = Object.fromEntries(a.bands.map((b) => [a.symbols[b.token] ?? b.token, { minBps: b.minBps, targetBps: b.targetBps, maxBps: b.maxBps }]));
  return { reason: 'BAND', signature: breachSignature(a.weights, a.bands, a.symbols), context: { weights: a.weights, bands, rebalancesToday: Number(a.rebalancesToday), maxRebalancesPerDay: a.maxRebalancesPerDay } };
}

/** At most one wake per account and breach per window: a refused rebalance must not wake the agent every tick, but a
 *  new price move must. */
export class Cooldown {
  private last = new Map<string, { at: number; signature: string }>();
  constructor(private readonly windowS: number) {}
  take(key: string, nowS: number, signature = ''): boolean {
    const t = this.last.get(key);
    if (t !== undefined && t.signature === signature && nowS - t.at < this.windowS) return false;
    this.last.set(key, { at: nowS, signature });
    return true;
  }
}
