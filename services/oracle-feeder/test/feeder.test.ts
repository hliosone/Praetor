import { describe, it, expect } from 'vitest';
import { decide, feedMode, normalisePyth, SEEDED } from '../src/feeder.js';
import { PriceSource } from '@praetor/protocol';

const NOW = 1_800_000_000n;
const last = (price8: bigint, age: bigint, source: number) => ({ price8, publishTime: NOW - age, source });

describe('normalisePyth (to 8 decimals)', () => {
  it('scales by the exponent', () => {
    expect(normalisePyth({ price: '265012345678', expo: -8 })).toBe(265012345678n);
    expect(normalisePyth({ price: '2650123', expo: -3 })).toBe(265012300000n);
    expect(normalisePyth({ price: '3112345678901', expo: -11 })).toBe(3112345678n);
  });
  it('refuses a non-positive price', () => {
    expect(() => normalisePyth({ price: '0', expo: -8 })).toThrow();
  });
});

describe('decide', () => {
  const pyth = (price8: bigint, publish = NOW - 5n) => ({ price8, publishTime: publish, source: PriceSource.PYTH });

  it('pushes a Pyth price that moved more than 0.2%, capped at the Base time', () => {
    expect(decide({ now: NOW, last: last(100_000_000n, 60n, PriceSource.PYTH), next: pyth(100_300_000n, NOW + 30n), holdS: 600n })).toEqual({ price8: 100_300_000n, publishTime: NOW, source: PriceSource.PYTH });
  });
  it('skips a small move, unless the last update is older than 30 minutes', () => {
    expect(decide({ now: NOW, last: last(100_000_000n, 60n, PriceSource.PYTH), next: pyth(100_100_000n), holdS: 600n })).toBeNull();
    expect(decide({ now: NOW, last: last(100_000_000n, 1801n, PriceSource.PYTH), next: pyth(100_100_000n), holdS: 600n })).not.toBeNull();
  });
  it('holds a demo shock for DEMO_HOLD_S before anything replaces it', () => {
    expect(decide({ now: NOW, last: last(120_000_000n, 300n, PriceSource.DEMO), next: pyth(100_000_000n), holdS: 600n })).toBeNull();
    expect(decide({ now: NOW, last: last(120_000_000n, 601n, PriceSource.DEMO), next: pyth(100_000_000n), holdS: 600n })).not.toBeNull();
  });
  it('never pushes a publish time older than the last one, nor a jump the oracle would refuse (> 25%)', () => {
    expect(decide({ now: NOW, last: last(100_000_000n, 10n, PriceSource.PYTH), next: pyth(110_000_000n, NOW - 20n), holdS: 600n })).toBeNull();
    expect(decide({ now: NOW, last: last(100_000_000n, 2000n, PriceSource.PYTH), next: pyth(126_000_000n), holdS: 600n })).toBeNull();
  });
  it('first price ever is pushed', () => {
    expect(decide({ now: NOW, last: null, next: pyth(100_000_000n), holdS: 600n })).not.toBeNull();
  });
  it('seeded mode: the fixed prices with source DEMO, refreshed every 30 minutes', () => {
    expect(SEEDED.XAU).toBe(265_000_000_000n);
    const next = { price8: SEEDED.XAU, publishTime: NOW, source: PriceSource.DEMO };
    expect(decide({ now: NOW, last: last(SEEDED.XAU, 60n, PriceSource.DEMO), next, holdS: 600n })).toBeNull();
    expect(decide({ now: NOW, last: last(SEEDED.XAU, 1801n, PriceSource.DEMO), next, holdS: 600n })).toEqual({ price8: SEEDED.XAU, publishTime: NOW, source: PriceSource.DEMO });
  });
});

describe('feedMode (D89)', () => {
  it('reads Pyth only on live Base Sepolia with a key: the fork keeps the demo prices its tests set', () => {
    expect(feedMode({ pythKey: 'k', chainMode: 'live' })).toBe('pyth');
    // Real prices are more than 25% from the demo ones: the oracle would refuse the tests' demo prices after them.
    expect(feedMode({ pythKey: 'k', chainMode: 'fork' })).toBe('seeded');
    expect(feedMode({ pythKey: '', chainMode: 'live' })).toBe('seeded');
  });
});
