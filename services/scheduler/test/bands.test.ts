import { describe, it, expect } from 'vitest';
import { weightsOf, bandWake, Cooldown } from '../src/bands.js';

const T = { usdc: '0xu', txau: '0xa', txag: '0xg' };
const bands = [{ token: T.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 }, { token: T.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 }, { token: T.txag, minBps: 0, targetBps: 1500, maxBps: 1500 }];

describe('weights', () => {
  it('values balances at oracle prices (USDC 6 decimals, tokens 18) and returns bps', () => {
    const w = weightsOf([
      { token: T.usdc, symbol: 'USDC', balance: 5_300_000_000n, decimals: 6, price8: 100_000_000n },
      { token: T.txau, symbol: 'tXAU', balance: 1_207_547_169_811_320_754n, decimals: 18, price8: 318_000_000_000n },
      { token: T.txag, symbol: 'tXAG', balance: 48_200_514_138_817_480_719n, decimals: 18, price8: 3_112_000_000n },
    ]);
    expect(w.tXAU).toBeGreaterThan(3600);
    expect(w.tXAU).toBeLessThan(3620);
    expect(w.USDC! + w.tXAU! + w.tXAG!).toBeGreaterThanOrEqual(9998);
  });
});

describe('band wake (F4 step 2)', () => {
  const weights = { USDC: 4980, tXAU: 3610, tXAG: 1410 };
  const sym = { [T.usdc]: 'USDC', [T.txau]: 'tXAU', [T.txag]: 'tXAG' };
  it('wakes when an asset is outside its band and rebalances are left today', () => {
    expect(bandWake({ weights, bands, symbols: sym, rebalancesToday: 0n, maxRebalancesPerDay: 1 })).toMatchObject({ reason: 'BAND', context: { rebalancesToday: 0, maxRebalancesPerDay: 1, weights } });
  });
  it('does not wake inside the bands, or when today\'s rebalances are used up', () => {
    expect(bandWake({ weights: { USDC: 5500, tXAU: 3000, tXAG: 1500 }, bands, symbols: sym, rebalancesToday: 0n, maxRebalancesPerDay: 1 })).toBeNull();
    expect(bandWake({ weights, bands, symbols: sym, rebalancesToday: 1n, maxRebalancesPerDay: 1 })).toBeNull();
  });
});

describe('cooldown', () => {
  it('wakes an account at most once per window', () => {
    const c = new Cooldown(900);
    expect(c.take('a', 1000)).toBe(true);
    expect(c.take('a', 1500)).toBe(false);
    expect(c.take('b', 1500)).toBe(true);
    expect(c.take('a', 1901)).toBe(true);
  });
});
