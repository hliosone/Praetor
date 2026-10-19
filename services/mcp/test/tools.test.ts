import { describe, it, expect, beforeEach } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';
import { TreasuryDeskAbi } from '@praetor/chain';
import { Reason, Tier, PriceSource, Status, type Policy } from '@praetor/protocol';
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
    ownerHold: async () => ({ paused: false, recoveryPending: false }),
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

  it('on the local fork: the bare hash and no explorer link, so nobody is sent to a BaseScan page that does not exist (#9)', async () => {
    const fork = () => new PraetorTools(ACCOUNT, { ...ports(), explorer: null });
    const done = await fork().pay({ payee: 'Café Lumen', amount: '12.50' });
    expect(done.text).toContain(`Transaction: 0x${'bb'.repeat(32)} (local fork, no public explorer link)`);
    verdict = { reason: Reason.SANCTIONED, tier: Tier.T0_NEVER };
    const refused = await fork().pay({ payee: BAD, amount: '5000' });
    expect(refused.text).toContain(`Refused operation: 0x${'bb'.repeat(32)} (local fork, no public explorer link); refusal record: 0x${'cc'.repeat(32)} (local fork, no public explorer link)`);
    for (const r of [done, refused]) expect(r.text).not.toMatch(/basescan|\/tx\//i);
  });

  it('a payee name resolves to its exact label first, a unique partial name to its label, an ambiguous one to nothing (red team D62)', async () => {
    const BISTRO = '0x00000000000000000000000000000000000b1570' as Address;
    const LUMEN = '0x000000000000000000000000000000000001ee11' as Address;
    const labels = { [BISTRO.toLowerCase()]: 'Lumen Bistro', [LUMEN.toLowerCase()]: 'Lumen', [CAFE.toLowerCase()]: 'Café Lumen' };
    const t = () => new PraetorTools(ACCOUNT, { ...ports(), labels: async () => labels });
    await t().pay({ payee: 'lumen', amount: '1' });
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[0]!.calls[0]!.data }).args![0]).toBe(getAddress(LUMEN));
    await t().pay({ payee: 'bistro', amount: '1' });
    expect(decodeFunctionData({ abi: erc20Abi, data: sent[1]!.calls[0]!.data }).args![0]).toBe(getAddress(BISTRO));
    const r = await t().pay({ payee: 'Lum', amount: '1' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/several payees match "Lum": Lumen Bistro, Lumen, Café Lumen/);
    expect(sent).toHaveLength(2);
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

  it('T2: the approval request names every T2 reason that applies, the hook\'s first; the agent text keeps the hook\'s one (red-team parser)', async () => {
    verdict = { reason: Reason.UNKNOWN_PAYEE, tier: Tier.T2_HUMAN };
    const r = await tools().pay({ payee: '0x00000000000000000000000000000000000beef1', amount: '600' });
    expect((requested[0] as { reason: string }).reason).toBe('UNKNOWN_PAYEE,OVER_AUTO_CAP,BUDGET_EXCEEDED');
    expect(r.text).toMatch(/^Not done yet: UNKNOWN_PAYEE needs the owner's approval\. Request apr_1 /);
    expect(r.structured).toMatchObject({ reason: 'UNKNOWN_PAYEE', reasons: ['UNKNOWN_PAYEE', 'OVER_AUTO_CAP', 'BUDGET_EXCEEDED'] });
  });

  it('T2 reasons include the owner\'s pause, a stale heartbeat, the count and the buffer, in the hook\'s order, as whole names within 64 characters', async () => {
    verdict = { reason: Reason.RESTRICTED, tier: Tier.T2_HUMAN };
    const p = ports();
    p.reader.ownerHold = async () => ({ paused: true, recoveryPending: false });
    p.reader.status = async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 1_799_999_999n });
    p.reader.spent = async () => ({ day: 0n, month: 0n, count: 10n, rebalances: 0n });
    p.reader.balances = async () => ({ [T.usdc]: 1_100_000_000n });
    await new PraetorTools(ACCOUNT, p).pay({ payee: 'Café Lumen', amount: '150' });
    expect((requested[0] as { reason: string }).reason).toBe('RESTRICTED,STALE_STATUS,COUNT_EXCEEDED,BUFFER_BREACH');
    requested = [];
    await new PraetorTools(ACCOUNT, p).pay({ payee: '0x00000000000000000000000000000000000beef1', amount: '600' });
    const all = (requested[0] as { reason: string }).reason;
    expect(all.length).toBeLessThanOrEqual(64);
    expect(all).toBe('RESTRICTED,STALE_STATUS,UNKNOWN_PAYEE,OVER_AUTO_CAP');
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

  it('T2: the approval request binds the swap\'s callHash, which the hook looks up, not the approve that only inherits its decision', async () => {
    verdict = { reason: Reason.REBALANCE_LIMIT, tier: Tier.T2_HUMAN };
    const p = ports();
    const hashOf = (i: number) => `0x${String(i + 1).repeat(64)}` as Hex;
    p.reader.check = async (_a, calls) => calls.map((_c, i) => ({ ...verdict, callHash: hashOf(i) }));
    const r = await new PraetorTools(ACCOUNT, p).rebalance({ sell: 'tXAU', buy: 'USDC', amountUsd: '650' });
    expect(r.structured).toMatchObject({ done: false, approvalId: 'apr_1', reason: 'REBALANCE_LIMIT' });
    expect(requested).toHaveLength(1);
    const req = requested[0] as { calls: { to: Address }[]; callHash: Hex };
    expect(req.calls.map((c) => c.to)).toEqual([T.txau, T.desk]);
    expect(req.callHash).toBe(hashOf(1));
  });

  it('T2: the approval request names the rebalance limit and a projected cash-buffer breach together', async () => {
    verdict = { reason: Reason.REBALANCE_LIMIT, tier: Tier.T2_HUMAN };
    const p = ports();
    p.reader.spent = async () => ({ day: 0n, month: 0n, count: 0n, rebalances: 1n });
    p.reader.balances = async () => ({ [T.usdc]: 1_500_000_000n, [T.txau]: 10n ** 18n, [T.txag]: 0n });
    p.reader.quote = async () => 10n ** 30n;
    await new PraetorTools(ACCOUNT, p).rebalance({ sell: 'USDC', buy: 'tXAU', amountUsd: '650' });
    expect((requested[0] as { reason: string }).reason).toBe('REBALANCE_LIMIT,BUFFER_BREACH');
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

  it('T2: says calling pay asks the owner to approve it, not that it is refused or final (#4)', async () => {
    verdict = { reason: Reason.UNKNOWN_PAYEE, tier: Tier.T2_HUMAN };
    const r = await tools().explain({ type: 'pay', payee: '0x000000000000000000000000000000000000dEaD', amount: '300' });
    expect(r.text).toMatch(/UNKNOWN_PAYEE \(T2_HUMAN\)/);
    expect(r.text).toMatch(/not a refusal/i);
    expect(r.text).toMatch(/call pay/i);
    expect(r.text).toMatch(/approval request/i);
    expect(r.text).toMatch(/WeChat or the web app/);
    expect(r.text).not.toMatch(/refused|final/i);
    expect(r.isError).toBeFalsy();
    expect(sent).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  it('T2 rebalance: needs the owner, not refused, but no hint to submit it (an approved rebalance cannot be resubmitted yet, D93)', async () => {
    verdict = { reason: Reason.REBALANCE_LIMIT, tier: Tier.T2_HUMAN };
    const r = await tools().explain({ type: 'rebalance', sell: 'tXAU', buy: 'USDC', amountUsd: '650' });
    expect(r.text).toMatch(/needs the owner's approval: REBALANCE_LIMIT \(T2_HUMAN\)/);
    expect(r.text).not.toMatch(/refused|final/i);
    expect(r.text).not.toMatch(/call rebalance/i);
  });

  it('T0: keeps "refused" and "final" for what nobody can approve', async () => {
    verdict = { reason: Reason.SANCTIONED, tier: Tier.T0_NEVER };
    const r = await tools().explain({ type: 'pay', payee: BAD, amount: '5000' });
    expect(r.text).toMatch(/would be refused: SANCTIONED \(T0_NEVER\)/);
    expect(r.text).toMatch(/final/i);
    expect(r.text).not.toMatch(/approval request/i);
    expect(r.structured).toMatchObject({ reasons: ['SANCTIONED'], tier: 'T0_NEVER' });
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

describe('get_mandate spending (#7)', () => {
  it('quotes the hook\'s own counters (UTC day, 30-day period), approved payments included, and says an approval can pass the owner\'s budget, never the bank\'s limits', async () => {
    const p = ports();
    p.reader.spent = async () => ({ day: 530_000_000n, month: 1_060_000_000n, count: 2n, rebalances: 0n });
    const m = await new PraetorTools(ACCOUNT, p).getMandate();
    expect(m.text).toMatch(/Spent today \(UTC day on Base\): 530\.00 of the 500\.00 USDC daily budget, 2 of 10 daily payments; this 30-day period: 1060\.00 of 3000\.00\./);
    expect(m.text).toMatch(/Owner-approved payments count too, and standing orders count in the amounts \(not in the payments\); an owner approval can take spending past the owner's budgets, never past the bank's limits\./);
    expect(m.structured).toMatchObject({ spentToday: '530.00', spentThisPeriod: '1060.00', paymentsToday: 2 });
  });
});

describe('get_status when the consortium tightened the account (#6)', () => {
  const withStatus = (account: number, global: number) => {
    const p = ports();
    p.reader.status = async () => ({ effective: Math.max(account, global), account, global, heartbeatValidUntil: 1_800_000_900n });
    return new PraetorTools(ACCOUNT, p).getStatus();
  };

  it('a freeze of this account: what it stops, who set it, who can lift it, and no guessed reason', async () => {
    const r = await withStatus(Status.FROZEN, Status.ACTIVE);
    expect(r.text).toMatch(/^Status: FROZEN/);
    expect(r.text).toMatch(/Set by the consortium \(bank, regulator, operator\): this account is frozen\./);
    expect(r.text).not.toMatch(/every account/);
    expect(r.text).toMatch(/no payment, rebalance or standing order can move money, the owner's own included/);
    expect(r.text).toMatch(/Any one member can freeze or restrict; lifting or loosening needs two of the three\. The owner cannot lift it\./);
    expect(r.text).toMatch(/The tools do not say why it was set: do not guess a reason\./);
    expect(r.structured).toMatchObject({ status: 'FROZEN', accountStatus: 'FROZEN', globalStatus: 'ACTIVE' });
  });

  it('a global restriction: says it covers every account and what restricted means', async () => {
    const r = await withStatus(Status.ACTIVE, Status.RESTRICTED);
    expect(r.text).toMatch(/^Status: RESTRICTED/);
    expect(r.text).toMatch(/Set by the consortium \(bank, regulator, operator\): every account is restricted \(global\)\./);
    expect(r.text).toMatch(/every payment or rebalance the agent makes needs the owner's approval/);
    expect(r.text).toMatch(/two of the three/);
  });

  it('active: no consortium text', async () => {
    const r = await withStatus(Status.ACTIVE, Status.ACTIVE);
    expect(r.text).toMatch(/^Status: ACTIVE/);
    expect(r.text).not.toMatch(/consortium/);
  });
});

describe('get_status when the owner paused the agent or a key recovery is pending', () => {
  const withHold = (hold: { paused: boolean; recoveryPending: boolean }, account = Status.ACTIVE) => {
    const p = ports();
    p.reader.status = async () => ({ effective: account, account, global: Status.ACTIVE, heartbeatValidUntil: 1_800_000_900n });
    p.reader.ownerHold = async () => hold;
    return new PraetorTools(ACCOUNT, p).getStatus();
  };

  it('the owner\'s pause: RESTRICTED, set by the owner (not the consortium), lifted by the owner resuming the agent', async () => {
    const r = await withHold({ paused: true, recoveryPending: false });
    expect(r.text).toMatch(/^Status: RESTRICTED/);
    expect(r.text).toMatch(/The owner paused the agent: every payment or rebalance the agent makes needs the owner's approval until the owner resumes it\./);
    expect(r.text).not.toMatch(/Set by the consortium/);
    expect(r.structured).toMatchObject({ status: 'RESTRICTED', accountStatus: 'ACTIVE', globalStatus: 'ACTIVE', ownerPaused: true, recoveryPending: false });
  });

  it('a pending key recovery: RESTRICTED until it completes or the owner cancels it', async () => {
    const r = await withHold({ paused: false, recoveryPending: true });
    expect(r.text).toMatch(/^Status: RESTRICTED/);
    expect(r.text).toMatch(/A key recovery of this account is pending: every payment or rebalance the agent makes needs the owner's approval until it completes or the owner cancels it\./);
    expect(r.text).not.toMatch(/Set by the consortium/);
    expect(r.structured).toMatchObject({ status: 'RESTRICTED', ownerPaused: false, recoveryPending: true });
  });

  it('a consortium freeze stays FROZEN and names the owner\'s pause as well', async () => {
    const r = await withHold({ paused: true, recoveryPending: false }, Status.FROZEN);
    expect(r.text).toMatch(/^Status: FROZEN/);
    expect(r.text).toMatch(/Set by the consortium/);
    expect(r.text).toMatch(/The owner paused the agent/);
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
