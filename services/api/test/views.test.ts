import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import { PriceSource, type Policy } from '@praetor/protocol';
import { Views, type Reader } from '../src/views.js';

const A = '0x00000000000000000000000000000000000c0ffe' as Address;
const T = { usdc: '0x00000000000000000000000000000000000000a1' as Address, txau: '0x00000000000000000000000000000000000000a2' as Address, txag: '0x00000000000000000000000000000000000000a3' as Address };
const policy: Policy = {
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 1_000_000_000n,
  payees: [], merchants: [],
  bands: [{ token: T.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 }, { token: T.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 }, { token: T.txag, minBps: 0, targetBps: 1500, maxBps: 1500 }],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: 2_000_000_000n, soterEnabled: true,
};
const reader = (o: Partial<Reader> = {}): Reader => ({
  // 5300 USDC, 3200 USD of gold at 2650, 1500 USD of silver at 31.12 (Lin, spec 00).
  balances: async () => ({ [T.usdc]: 5_300_000_000n, [T.txau]: (3_200_000_000n * 10n ** 20n) / 265_000_000_000n, [T.txag]: (1_500_000_000n * 10n ** 20n) / 3_112_000_000n }),
  price: async (t) => ({ price8: t === T.txau ? 265_000_000_000n : t === T.txag ? 3_112_000_000n : 100_000_000n, publishTime: 1n, source: t === T.usdc ? PriceSource.PYTH : PriceSource.DEMO }),
  policy: async () => policy,
  status: async () => ({ effective: 2, account: 2, global: 0, heartbeatValidUntil: 1_800_000_120n }),
  kya: async () => ({ agentKey: '0x00000000000000000000000000000000000a6e47' as Address, kycLevel: 2, riskProfile: 2, jurisdiction: '0x484b', validUntil: 1_900_000_000n }),
  caps: async () => ({ perTx: 5_000_000_000n, daily: 10_000_000_000n, monthly: 50_000_000_000n }),
  spent: async () => ({ day: 1n, month: 2n, count: 3n, rebalances: 0n }),
  activity: async () => [{ kind: 'decision', reason: 'OK', tier: 'T1_AUTONOMOUS', target: T.usdc, txHash: '0xaa', valueUsd6: '12500000' }],
  now: async () => 1_800_000_000n,
  ...o,
});

describe('owner views (spec 05 GET endpoints)', () => {
  it('portfolio: values in USD (6 decimals), weights against the bands, demo prices flagged', async () => {
    const p = await new Views({ reader: reader(), tokens: T }).portfolio(A);
    expect(Number(p.totalUsd6) / 1e6).toBeCloseTo(10_000, 0);
    expect(p.assets.map((a) => [a.symbol, Math.round(a.weightBps / 100)])).toEqual([['USDC', 53], ['tXAU', 32], ['tXAG', 15]]);
    expect(p.assets[1]).toMatchObject({ band: { minBps: 2000, targetBps: 3000, maxBps: 3500 }, demoPrice: true });
    expect(p.assets[0]!.demoPrice).toBe(false);
  });

  it('status by name, with the heartbeat deadline and Base time', async () => {
    expect(await new Views({ reader: reader(), tokens: T }).status(A)).toEqual({ effective: 'FROZEN', heartbeatValidUntil: '1800000120', now: '1800000000' });
  });

  it('policy as JSON (decimal strings), caps and what was spent; null without a policy', async () => {
    const v = await new Views({ reader: reader(), tokens: T }).policy(A);
    expect(v.policy).toMatchObject({ autoCap: '200000000', dailyCount: 10, bands: [{ token: T.usdc, minBps: 4000 }, expect.anything(), expect.anything()] });
    expect(v.caps).toEqual({ perTx: '5000000000', daily: '10000000000', monthly: '50000000000' });
    expect((await new Views({ reader: reader({ policy: async () => null }), tokens: T }).policy(A)).policy).toBeNull();
  });

  it('agent: the KYA in words (profile, jurisdiction as letters)', async () => {
    expect(await new Views({ reader: reader(), tokens: T }).agent(A)).toEqual({ agentKey: '0x00000000000000000000000000000000000a6e47', kycLevel: 2, riskProfile: 'BALANCED', jurisdiction: 'HK', validUntil: '1900000000' });
  });
});
