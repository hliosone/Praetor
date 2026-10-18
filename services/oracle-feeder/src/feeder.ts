// oracle-feeder (spec 05): Pyth XAU/XAG into PriceOracle every minute, or, without PYTH_API_KEY, the seeded demo
// prices with source DEMO (Q27). A demo shock (scripts/demo/shock.ts) is held for DEMO_HOLD_S before anything
// replaces it. The oracle refuses older publish times, future ones and moves over 25%: never send those.
import { PriceSource } from '@praetor/protocol';

export const PYTH_IDS = {
  XAU: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  XAG: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
} as const;

/** Pyth only on live Base Sepolia with a key (D89): the fork keeps the demo prices its tests set, which the oracle
 *  could not take back after real ones (more than 25% apart). */
export function feedMode(o: { pythKey: string; chainMode: string }): 'pyth' | 'seeded' {
  return o.pythKey && o.chainMode === 'live' ? 'pyth' : 'seeded';
}

/** Seconds to the next tick: a failed one is retried within 30 s, since health needs a successful tick. */
export function nextTickS(failed: boolean, everyS: number): number {
  return failed ? Math.min(30, everyS) : everyS;
}

/** Seeded mode (Q27): the demo prices of spec 00, 8 decimals. */
export const SEEDED = { XAU: 265_000_000_000n, XAG: 3_112_000_000n } as const;

const MOVE_BPS = 20n; // 0.2%
const REFRESH_S = 1800n;
const MAX_DEVIATION_BPS = 2500n;

export function normalisePyth(p: { price: string; expo: number }): bigint {
  const v = BigInt(p.price);
  if (v <= 0n) throw new Error('non-positive price');
  const shift = p.expo + 8;
  return shift >= 0 ? v * 10n ** BigInt(shift) : v / 10n ** BigInt(-shift);
}

export type Update = { price8: bigint; publishTime: bigint; source: number };

export function decide(a: { now: bigint; last: Update | null; next: Update; holdS: bigint }): Update | null {
  const publishTime = a.next.publishTime > a.now ? a.now : a.next.publishTime;
  const out = { price8: a.next.price8, publishTime, source: a.next.source };
  if (!a.last) return out;
  if (a.last.source === PriceSource.DEMO && a.now - a.last.publishTime < a.holdS && a.next.price8 !== a.last.price8) return null;
  if (publishTime < a.last.publishTime) return null;
  const diff = a.next.price8 > a.last.price8 ? a.next.price8 - a.last.price8 : a.last.price8 - a.next.price8;
  if (diff * 10_000n > a.last.price8 * MAX_DEVIATION_BPS) return null;
  const moved = diff * 10_000n > a.last.price8 * MOVE_BPS;
  const old = a.now - a.last.publishTime > REFRESH_S;
  return moved || old ? out : null;
}
