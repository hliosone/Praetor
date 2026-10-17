// The scheduler's free check (spec 05, F4 step 2): portfolio weights at oracle prices against the mandate's bands.

export type Holding = { token: string; symbol: string; balance: bigint; decimals: number; price8: bigint };
export type Band = { token: string; minBps: number; targetBps: number; maxBps: number };

export function weightsOf(h: Holding[]): Record<string, number> {
  const values = h.map((x) => ({ symbol: x.symbol, v: (x.balance * x.price8) / 10n ** BigInt(x.decimals + 2) }));
  const total = values.reduce((s, x) => s + x.v, 0n);
  return Object.fromEntries(values.map((x) => [x.symbol, total > 0n ? Number((x.v * 10_000n) / total) : 0]));
}

export function bandWake(a: { weights: Record<string, number>; bands: Band[]; symbols: Record<string, string>; rebalancesToday: bigint; maxRebalancesPerDay: number }) {
  if (a.rebalancesToday >= BigInt(a.maxRebalancesPerDay)) return null;
  const out = a.bands.some((b) => {
    const w = a.weights[a.symbols[b.token] ?? ''] ?? 0;
    return w < b.minBps || w > b.maxBps;
  });
  if (!out) return null;
  const bands = Object.fromEntries(a.bands.map((b) => [a.symbols[b.token] ?? b.token, { minBps: b.minBps, targetBps: b.targetBps, maxBps: b.maxBps }]));
  return { reason: 'BAND', context: { weights: a.weights, bands, rebalancesToday: Number(a.rebalancesToday), maxRebalancesPerDay: a.maxRebalancesPerDay } };
}

/** At most one wake per account per window: a refused rebalance must not wake the agent every tick. */
export class Cooldown {
  private last = new Map<string, number>();
  constructor(private readonly windowS: number) {}
  take(key: string, nowS: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && nowS - t < this.windowS) return false;
    this.last.set(key, nowS);
    return true;
  }
}
