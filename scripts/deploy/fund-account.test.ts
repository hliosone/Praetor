import { describe, it, expect } from 'vitest';
import { parseFundArgs } from './fund-account.js';

const A = '0x00000000000000000000000000000000000c0ffe';

describe('fund-account arguments', () => {
  it('takes the on-chain USD amounts, with up to 6 decimals', () => {
    expect(parseFundArgs([A, '5', '2', '1'])).toEqual({ account: A, usdc: 5_000_000n, xauUsd6: 2_000_000n, xagUsd6: 1_000_000n });
    expect(parseFundArgs([A, '0.5', '0', '0.000001'])).toEqual({ account: A, usdc: 500_000n, xauUsd6: 0n, xagUsd6: 1n });
  });

  it('accepts the live ceiling (10 USDC, 6 USD of tXAU, 3 USD of tXAG) and refuses anything above it', () => {
    expect(parseFundArgs([A, '10', '6', '3'])).toEqual({ account: A, usdc: 10_000_000n, xauUsd6: 6_000_000n, xagUsd6: 3_000_000n });
    expect(() => parseFundArgs([A, '10.000001', '0', '0'])).toThrow(/USDC/);
    expect(() => parseFundArgs([A, '5300', '3200', '1500'])).toThrow(/USDC/);
    expect(() => parseFundArgs([A, '1', '6.01', '0'])).toThrow(/tXAU/);
    expect(() => parseFundArgs([A, '1', '0', '3.01'])).toThrow(/tXAG/);
  });

  it('refuses amounts that are not plain decimals: negative, exponent, more than 6 decimals, hex, words, empty', () => {
    for (const bad of ['-1', '1e3', '0.0000001', '0x10', 'five', '1,5', ' 1', '.5', ''])
      expect(() => parseFundArgs([A, bad, '0', '0']), JSON.stringify(bad)).toThrow(/amount/);
  });

  it('refuses a bad account address and a wrong number of arguments', () => {
    expect(() => parseFundArgs(['0x1234', '1', '1', '1'])).toThrow(/account/);
    expect(() => parseFundArgs([A, '1', '1'])).toThrow(/usage/);
    expect(() => parseFundArgs([A, '1', '1', '1', '1'])).toThrow(/usage/);
  });

  it('refuses to move nothing', () => {
    expect(() => parseFundArgs([A, '0', '0', '0'])).toThrow(/nothing/);
  });
});
