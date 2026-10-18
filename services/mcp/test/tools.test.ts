import { describe, it, expect, beforeEach } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';
import { TreasuryDeskAbi } from '@praetor/chain';
import { Reason, Tier, PriceSource, type Policy } from '@praetor/protocol';
import { PraetorTools, type Ports } from '../src/tools.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const T = { usdc: '0x00000000000000000000000000000000000000a1' as Address, txau: '0x00000000000000000000000000000000000000a2' as Address, txag: '0x00000000000000000000000000000000000000a3' as Address, desk: '0x00000000000000000000000000000000000000d5' as Address };
const CAFE = '0x00000000000000000000000000000000000ca4e1' as Address;
const BAD = '0x0000000000000000000000000000000000000bad' as Address;
const policy: Policy = {
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 1_000_000_000n,
  payees: [CAFE], merchants: [],
  bands: [{ token: T.usdc, minBps: 4000, targetBps: 5500, maxBps: 6000 }, { token: T.txau, minBps: 2000, targetBps: 3000, maxBps: 3500 }, { token: T.txag, minBps: 0, targetBps: 1500, maxBps: 1500 }],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: 2_000_000_000n, soterEnabled: true,
};

type Sent = { account: Address; calls: { to: Address; value: bigint; data: Hex }[] };
let sent: Sent[];
let verdict: { reason: number; tier: number };
let requested: unknown[];
let proposed: unknown[];
const ports = (): Ports => ({
  tokens: T,
  explorer: 'https://sepolia.basescan.org',
  reader: {
    balances: async () => ({ [T.usdc]: 5_300_000_000n, [T.txau]: 1_207_547_169_811_320_754n, [T.txag]: 48_200_514_138_817_480_719n }),
    price: async (t) => (t === T.txau ? { price8: 318_000_000_000n, publishTime: 1_800_000_000n, source: PriceSource.DEMO } : t === T.txag ? { price8: 3_112_000_000n, publishTime: 1_800_000_000n, source: PriceSource.DEMO } : { price8: 100_000_000n, publishTime: 1_800_000_000n, source: PriceSource.PYTH }),
    policy: async () => policy,
    status: async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 1_800_000_900n }),
    kya: async () => ({ agentKey: '0x00000000000000000000000000000000000a6e47' as Address, validUntil: 1_900_000_000n, riskProfile: 2 }),
    caps: async () => ({ perTx: 1_000_000_000n, daily: 2_000_000_000n, monthly: 10_000_000_000n }),
    spent: async () => ({ day: 0n, month: 0n, count: 0n, rebalances: 0n }),
    check: async (_a, calls) => calls.map(() => ({ ...verdict, callHash: `0x${'11'.repeat(32)}` as Hex })),
    quote: async (_i, _o, amountIn) => (amountIn * 318_000_000_000n) / 10n ** 20n,
    activity: async () => [],
    now: async () => 1_800_000_000n,
  },
  submit: async (account, calls) => {
    sent.push({ account, calls });
    const ok = verdict.reason === Reason.OK;
    return { userOpHash: `0x${'aa'.repeat(32)}` as Hex, txHash: `0x${'bb'.repeat(32)}` as Hex, success: ok, reasons: ok ? [] : [verdict.reason], refusalLogTx: ok ? null : (`0x${'cc'.repeat(32)}` as Hex) };
  },
  approvals: {
    request: async (r) => { requested.push(r); return { id: 'apr_1' }; },
    get: async (_a, id) => (id === 'apr_1' ? { state: 'pending' } : null),
  },
  labels: async () => ({ [CAFE.toLowerCase()]: 'Café Lumen' }),
  proposals: { standingOrder: async (r) => { proposed.push(r); return { id: 'sop_1' }; } },
});

beforeEach(() => { sent = []; requested = []; proposed = []; verdict = { reason: Reason.OK, tier: Tier.T1_AUTONOMOUS }; });
const tools = () => new PraetorTools(ACCOUNT, ports());

describe('get_portfolio', () => {
  it('shows balances, USD values, weights against bands, and flags demo prices', async () => {
    const r = await tools().getPortfolio();
    const s = r.structured as { assets: { symbol: string; weightBps: number; band: { maxBps: number } | null }[]; demoPrice: boolean };
    expect(s.demoPrice).toBe(true);
    const xau = s.assets.find((a) => a.symbol === 'tXAU')!;
    expect(xau.weightBps).toBeGreaterThan(3500);
    expect(xau.band!.maxBps).toBe(3500);
    expect(r.text).toMatch(/demo price/);
    expect(r.text).toMatch(/tXAU.*above its 35% max/);
  });
});

describe('pay', () => {
  it('T1: transfers USDC to the payee through the agent signature and reports the tx', async () => {
    const r = await tools().pay({ payee: 'Café Lumen', amount: '12.50' });
    expect(r.isError).toBeFalsy();
    expect(sent).toHaveLength(1);
    const call = sent[0]!.calls[0]!;
    expect(call.to).toBe(T.usdc);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data }).args).toEqual([getAddress(CAFE), 12_500_000n]);
    expect(r.text).toMatch(/Paid 12.50 USDC to Café Lumen/);
    expect(r.text).toContain(`https://sepolia.basescan.org/tx/0x${'bb'.repeat(32)}`);
  });

  it('on the local fork (no explorer) reports the hash marked local, never a Basescan link (issue #9)', async () => {
    const r = await new PraetorTools(ACCOUNT, { ...ports(), explorer: null }).pay({ payee: 'Café Lumen', amount: '12.50' });
    expect(r.text).toContain(`tx 0x${'bb'.repeat(32)} (local fork, no public explorer)`);
    expect(r.text).not.toContain('basescan');
  });

  it('T0: still submits (on-chain evidence), then reports a final refusal with the reason and both links', async () => {
    verdict = { reason: Reason.SANCTIONED, tier: Tier.T0_NEVER };
    const r = await tools().pay({ payee: BAD, amount: '5000' });
    expect(sent).toHaveLength(1);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Blocked: SANCTIONED/);
    expect(r.text).toMatch(/Do not retry/);
    expect(r.text).toContain(`0x${'cc'.repeat(32)}`);
    expect(requested).toHaveLength(0);
  });

  it('T2: submits for evidence, opens an approval request, says it waits for the owner', async () => {
    verdict = { reason: Reason.UNKNOWN_PAYEE, tier: Tier.T2_HUMAN };
    const r = await tools().pay({ payee: '0x00000000000000000000000000000000000beef1', amount: '300' });
    expect(sent).toHaveLength(1);
    expect(requested).toHaveLength(1);
    expect(r.text).toMatch(/waiting for the owner/i);
    expect(r.structured).toMatchObject({ approvalId: 'apr_1', reason: 'UNKNOWN_PAYEE' });
  });

  it('refuses a payee it cannot resolve and a malformed amount without sending anything', async () => {
    expect((await tools().pay({ payee: 'the moon', amount: '1' })).isError).toBe(true);
    expect((await tools().pay({ payee: CAFE, amount: '-3' })).isError).toBe(true);
    expect((await tools().pay({ payee: CAFE, amount: '1.0000001' })).isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('rebalance', () => {
  it('sells tXAU for USDC: approve then desk.swap with minOut from the desk quote minus maxSlippage', async () => {
    const r = await tools().rebalance({ sell: 'tXAU', buy: 'USDC', amountUsd: '650' });
    expect(r.isError).toBeFalsy();
    const [approve, swap] = sent[0]!.calls;
    expect(approve!.to).toBe(T.txau);
    const amountIn = (650_000_000n * 10n ** 20n) / 318_000_000_000n;
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([getAddress(T.desk), amountIn]);
    expect(swap!.to).toBe(T.desk);
    const s = decodeFunctionData({ abi: TreasuryDeskAbi, data: swap!.data });
    expect(s.functionName).toBe('swap');
    // The hook's rule (DecisionLib._swap): minOut >= oracleOut * (1 - maxSlippage), oracleOut at the oracle price
    // without the desk's spread; the desk quote (spread included) must still meet it.
    const usdIn = (amountIn * 318_000_000_000n) / 10n ** 20n;
    const oracleOut = (usdIn * 10n ** 8n) / 100_000_000n;
    expect(s.args).toEqual([getAddress(T.txau), getAddress(T.usdc), amountIn, (oracleOut * 9900n) / 10000n]);
    expect(r.text).toMatch(/Sold 650.00 USD of tXAU/);
  });

  it('refuses locally when the desk quote cannot meet the slippage floor', async () => {
    const p = ports();
    p.reader.quote = async (_i, _o, amountIn) => (amountIn * 318_000_000_000n * 9800n) / 10n ** 20n / 10000n;
    const r = await new PraetorTools(ACCOUNT, p).rebalance({ sell: 'tXAU', buy: 'USDC', amountUsd: '650' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/slippage/i);
    expect(sent).toHaveLength(0);
  });

  it('refuses the same asset on both sides and unknown symbols', async () => {
    expect((await tools().rebalance({ sell: 'USDC', buy: 'USDC', amountUsd: '10' })).isError).toBe(true);
    expect((await tools().rebalance({ sell: 'DOGE', buy: 'USDC', amountUsd: '10' })).isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('explain', () => {
  it('dry-runs with the hook and never sends', async () => {
    verdict = { reason: Reason.OVER_AUTO_CAP, tier: Tier.T2_HUMAN };
    const r = await tools().explain({ type: 'pay', payee: CAFE, amount: '250' });
    expect(r.structured).toMatchObject({ reasons: ['OVER_AUTO_CAP'], tier: 'T2_HUMAN' });
    expect(sent).toHaveLength(0);
  });
});

describe('get_mandate and get_status', () => {
  it('describe the policy in plain words with payee names, and the status', async () => {
    const m = await tools().getMandate();
    expect(m.text).toMatch(/up to 200.00 USDC without asking/);
    expect(m.text).toMatch(/Café Lumen/);
    const st = await tools().getStatus();
    expect(st.text).toMatch(/ACTIVE/);
  });
});

describe('propose_standing_order (F7 step 1)', () => {
  it('a merchant order (payout rail) is an owner request only: nothing is sent, no approval is opened', async () => {
    const r = await tools().proposeStandingOrder({ merchant: 'KOWLOON-LETTINGS', amount: '1200', period: 'monthly' });
    expect(r.isError).toBeFalsy();
    expect(proposed).toEqual([{ account: ACCOUNT, merchant: 'KOWLOON-LETTINGS', amount: 1_200_000_000n, period: 'monthly', summary: '1200.00 USDC monthly to merchant KOWLOON-LETTINGS' }]);
    expect(sent).toHaveLength(0);
    expect(requested).toHaveLength(0);
    expect(r.text).toMatch(/sop_1/);
  });

  it('a direct order names a payee (label or address), resolved to its address', async () => {
    await tools().proposeStandingOrder({ payee: 'Café Lumen', amount: '25', period: 'weekly' });
    expect(proposed[0]).toMatchObject({ payee: getAddress(CAFE), amount: 25_000_000n, period: 'weekly', summary: '25.00 USDC weekly to Café Lumen' });
  });

  it('refuses a payee and a merchant together, neither, an unknown payee or a bad amount', async () => {
    expect((await tools().proposeStandingOrder({ payee: CAFE, merchant: 'KOWLOON-LETTINGS', amount: '1', period: 'weekly' })).isError).toBe(true);
    expect((await tools().proposeStandingOrder({ amount: '1', period: 'weekly' })).isError).toBe(true);
    expect((await tools().proposeStandingOrder({ payee: 'Nobody', amount: '1', period: 'weekly' })).isError).toBe(true);
    expect((await tools().proposeStandingOrder({ merchant: 'KOWLOON-LETTINGS', amount: '-1', period: 'weekly' })).isError).toBe(true);
    expect(proposed).toHaveLength(0);
  });
});
