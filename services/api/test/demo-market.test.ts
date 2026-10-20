import { describe, it, expect } from 'vitest';
import { DemoMarket } from '../src/demo-market.js';

const XAU = '0x00000000000000000000000000000000000000a1' as const;
const XAG = '0x00000000000000000000000000000000000000a2' as const;

function setup(fork = true) {
  const prices: Record<string, bigint> = { [XAU]: 265_000_000_000n, [XAG]: 3_112_000_000n };
  const sets: [string, bigint][] = [];
  const market = new DemoMarket({
    fork, tokens: { XAU, XAG },
    price: async (t) => prices[t]!,
    setDemoPrice: async (t, p) => { sets.push([t, p]); prices[t] = p; return '0xabc'; },
  });
  return { market, sets };
}

describe('demo market shock (local fork only)', () => {
  it('moves a metal by a percentage as a DEMO price, from the oracle\'s current price', async () => {
    const { market, sets } = setup();
    expect(await market.shock('XAU', 20)).toEqual({ asset: 'XAU', price8: '318000000000', txHash: '0xabc' });
    expect(sets).toEqual([[XAU, 318_000_000_000n]]);
    expect((await market.shock('XAG', -10)).price8).toBe('2800800000');
  });

  it('refuses on the live chain: Base Sepolia takes real prices from Pyth', async () => {
    await expect(setup(false).market.shock('XAU', 20)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses moves the oracle would refuse (over 25 %) and unknown assets', async () => {
    const { market } = setup();
    await expect(market.shock('XAU', 30)).rejects.toMatchObject({ status: 400 });
    await expect(market.shock('XAU', 0)).rejects.toMatchObject({ status: 400 });
    await expect(market.shock('BTC' as never, 10)).rejects.toMatchObject({ status: 400 });
  });
});
