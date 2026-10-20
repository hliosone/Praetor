// A demo price move for the video and the judges' local runs (spec 05, the shock script as a button): the oracle takes
// a DEMO price, which the feeder holds for DEMO_HOLD_S, and the scheduler wakes the agents whose bands it breaks.
// Local fork only: on Base Sepolia the oracle takes real prices from Pyth (D89).
import type { Address, Hex } from 'viem';
import { HttpError } from './app.js';

export type DemoAsset = 'XAU' | 'XAG';

export class DemoMarket {
  constructor(private readonly d: {
    fork: boolean;
    tokens: Record<DemoAsset, Address>;
    price(token: Address): Promise<bigint>;
    setDemoPrice(token: Address, price8: bigint): Promise<Hex>;
  }) {}

  async shock(asset: DemoAsset, pct: number): Promise<{ asset: DemoAsset; price8: string; txHash: Hex }> {
    if (!this.d.fork) throw new HttpError(409, 'demo prices exist only on the local fork; Base Sepolia takes real prices from Pyth');
    const token = this.d.tokens[asset];
    if (!token) throw new HttpError(400, 'unknown asset');
    // The oracle refuses moves over 25 %.
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 25) throw new HttpError(400, 'the move must be within 25 % and not zero');
    const next = ((await this.d.price(token)) * BigInt(Math.round((100 + pct) * 100))) / 10_000n;
    return { asset, price8: next.toString(), txHash: await this.d.setDemoPrice(token, next) };
  }
}
