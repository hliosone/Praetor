// The Praetor tools (spec 05) behind the MCP server, for one account (a token is bound to one account; no tool
// takes an account). Every action goes through the hook: explain() is its dry run, pay() and rebalance() always submit,
// so a refusal lands on-chain as evidence (I11). The texts tell the model what comes next: a T2 verdict means submit
// so the owner can approve, only a T0 refusal is final. Results never carry KYC data (I9): nothing here reads any.
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address, type Hex } from 'viem';
import { TreasuryDeskAbi } from '@praetor/chain';
import { PriceSource, REASONS, STATUSES, TIERS, Reason, Tier, type Policy } from '@praetor/protocol';

export type Call = { to: Address; value: bigint; data: Hex };
export type Verdict = { reason: number; tier: number; callHash: Hex };
export type PriceInfo = { price8: bigint; publishTime: bigint; source: number };
export type Submission = { userOpHash: Hex; txHash: Hex | null; success: boolean; reasons: number[]; refusalLogTx: Hex | null };
export type ActivityItem = { kind: 'decision' | 'refusal'; reason: string; tier: string; target: Address; txHash: Hex; valueUsd6?: string };

export type Ports = {
  tokens: { usdc: Address; txau: Address; txag: Address; desk: Address };
  explorer: string;
  reader: {
    balances(account: Address): Promise<Record<string, bigint>>;
    price(token: Address): Promise<PriceInfo>;
    policy(account: Address): Promise<Policy | null>;
    status(account: Address): Promise<{ effective: number; account: number; global: number; heartbeatValidUntil: bigint }>;
    kya(account: Address): Promise<{ agentKey: Address; validUntil: bigint; riskProfile: number }>;
    caps(account: Address): Promise<{ perTx: bigint; daily: bigint; monthly: bigint }>;
    spent(account: Address): Promise<{ day: bigint; month: bigint; count: bigint; rebalances: bigint }>;
    check(account: Address, calls: Call[]): Promise<Verdict[]>;
    quote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint>;
    activity(account: Address, limit: number): Promise<ActivityItem[]>;
    now(): Promise<bigint>;
  };
  submit(account: Address, calls: Call[]): Promise<Submission>;
  approvals: {
    request(r: { account: Address; calls: Call[]; callHash: Hex; reason: string; summary: string }): Promise<{ id: string }>;
    get(account: Address, id: string): Promise<Record<string, unknown> | null>;
  };
  /** The owner's requests in the api: a standing order the agent proposes waits there for the owner (never on-chain). */
  proposals: {
    standingOrder(r: { account: Address; payee?: Address; merchant?: string; amount: bigint; period: 'weekly' | 'monthly'; summary: string }): Promise<{ id: string }>;
  };
  /** Names the owner gave to addresses (lower-case address -> label). */
  labels(account: Address): Promise<Record<string, string>>;
  /** StandingOrders.execute through the bundler's /tx (the executor itself checks nextDue). */
  standingOrders?: { execute(account: Address, id: number): Promise<{ txHash: Hex | null; success: boolean }> };
};

export type ToolResult = { text: string; structured?: Record<string, unknown>; isError?: boolean };

const SYMBOLS = ['USDC', 'tXAU', 'tXAG'] as const;
type Symbol = (typeof SYMBOLS)[number];
const usd = (v6: bigint) => `${v6 < 0n ? '-' : ''}${(Number(v6 < 0n ? -v6 : v6) / 1e6).toFixed(2)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(1).replace(/\.0$/, '')}%`;
const reasonName = (r: number) => REASONS[r] ?? `REASON_${r}`;
const tierName = (t: number) => TIERS[t] ?? `TIER_${t}`;

/** "12.5" -> 12_500_000 (6 decimals); null for anything else. */
export function parseUsd6(s: string): bigint | null {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s.trim())) return null;
  const [i, f = ''] = s.trim().split('.');
  const v = BigInt(i!) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
  return v > 0n ? v : null;
}

export class PraetorTools {
  constructor(private readonly account: Address, private readonly p: Ports) {}

  private decimals(t: Address) {
    return t.toLowerCase() === this.p.tokens.usdc.toLowerCase() ? 6 : 18;
  }

  private tokenOf(sym: string): Address | null {
    const m: Record<Symbol, Address> = { USDC: this.p.tokens.usdc, tXAU: this.p.tokens.txau, tXAG: this.p.tokens.txag };
    return (m as Record<string, Address>)[sym] ?? null;
  }

  private symbolOf(t: Address): Symbol {
    const l = t.toLowerCase();
    return l === this.p.tokens.txau.toLowerCase() ? 'tXAU' : l === this.p.tokens.txag.toLowerCase() ? 'tXAG' : 'USDC';
  }

  private tx = (h: Hex | null) => (h ? `${this.p.explorer}/tx/${h}` : 'no transaction');

  async getPortfolio(): Promise<ToolResult> {
    const [balances, policy] = await Promise.all([this.p.reader.balances(this.account), this.p.reader.policy(this.account)]);
    const tokens = [this.p.tokens.usdc, this.p.tokens.txau, this.p.tokens.txag];
    const rows = await Promise.all(tokens.map(async (t) => {
      const balance = balances[t] ?? 0n;
      const price = await this.p.reader.price(t);
      const valueUsd6 = (balance * price.price8) / 10n ** BigInt(this.decimals(t) + 2);
      return { token: t, symbol: this.symbolOf(t), balance, price, valueUsd6 };
    }));
    const total = rows.reduce((s, r) => s + r.valueUsd6, 0n);
    const demoPrice = rows.some((r) => r.symbol !== 'USDC' && r.price.source === PriceSource.DEMO);
    const assets = rows.map((r) => {
      const weightBps = total > 0n ? Number((r.valueUsd6 * 10_000n) / total) : 0;
      const b = policy?.bands.find((x) => x.token.toLowerCase() === r.token.toLowerCase());
      return {
        symbol: r.symbol, token: r.token, balance: r.balance.toString(), price: Number(r.price.price8) / 1e8, valueUsd: usd(r.valueUsd6), weightBps,
        band: b ? { minBps: b.minBps, targetBps: b.targetBps, maxBps: b.maxBps } : null,
      };
    });
    const lines = assets.map((a) => {
      const band = a.band ? ` (band ${pct(a.band.minBps)} to ${pct(a.band.maxBps)}, target ${pct(a.band.targetBps)})` : '';
      const off = a.band && a.weightBps > a.band.maxBps ? `, above its ${pct(a.band.maxBps)} max` : a.band && a.weightBps < a.band.minBps ? `, below its ${pct(a.band.minBps)} min` : '';
      return `${a.symbol}: ${a.valueUsd} USD, ${pct(a.weightBps)}${band}${off}`;
    });
    if (demoPrice) lines.push('Gold and silver prices are demo prices (not live market data).');
    return { text: [`Portfolio: ${usd(total)} USD`, ...lines].join('\n'), structured: { totalUsd: usd(total), assets, demoPrice } };
  }

  async getMandate(): Promise<ToolResult> {
    const [policy, kya, labels] = await Promise.all([this.p.reader.policy(this.account), this.p.reader.kya(this.account), this.p.labels(this.account)]);
    if (!policy) return { text: 'No mandate is set: every action is refused until the owner sets one.', structured: { policy: null } };
    const caps = await this.p.reader.caps(this.account);
    const payees = policy.payees.map((a) => ({ address: a, label: labels[a.toLowerCase()] ?? null }));
    const lines = [
      `Payments: up to ${usd(policy.autoCap)} USDC without asking; above that the owner approves; never above ${usd(policy.hardCap)} USDC.`,
      `Budgets: ${usd(policy.dailyBudget)} USDC per day, ${usd(policy.monthlyBudget)} per month, at most ${policy.dailyCount} payments per day; keep at least ${usd(policy.bufferUsdc)} USDC.`,
      `Known payees: ${payees.map((x) => (x.label ? `${x.label} (${x.address})` : x.address)).join(', ') || 'none'}. A new payee needs the owner.`,
      `Bands: ${policy.bands.map((b) => `${this.symbolOf(b.token)} ${pct(b.minBps)} to ${pct(b.maxBps)} (target ${pct(b.targetBps)})`).join(', ')}.`,
      `Rebalancing: at most ${policy.maxRebalancesPerDay} per day, ${usd(policy.maxTradeUsd)} USD per trade, slippage ${pct(policy.maxSlippageBps)}.`,
      `Bank limits for this risk profile: ${usd(caps.perTx)} USD per transaction, ${usd(caps.daily)} per day.`,
      `Agent key valid until ${new Date(Number(kya.validUntil) * 1000).toISOString().slice(0, 10)}.`,
    ];
    return { text: lines.join('\n'), structured: { autoCap: usd(policy.autoCap), hardCap: usd(policy.hardCap), payees, bands: policy.bands.map((b) => ({ symbol: this.symbolOf(b.token), ...b, token: undefined })), maxRebalancesPerDay: policy.maxRebalancesPerDay } };
  }

  async getStatus(): Promise<ToolResult> {
    const [st, kya, now] = await Promise.all([this.p.reader.status(this.account), this.p.reader.kya(this.account), this.p.reader.now()]);
    const effective = STATUSES[st.effective] ?? 'UNKNOWN';
    const heartbeat = st.heartbeatValidUntil > now ? 'fresh' : 'stale (autonomous actions are paused until the operator heartbeat returns)';
    const kyaOk = kya.validUntil > now;
    return {
      text: [`Status: ${effective}`, `Heartbeat: ${heartbeat}`, `KYA: ${kyaOk ? 'valid' : 'expired'}`].join('\n'),
      structured: { status: effective, heartbeatFresh: st.heartbeatValidUntil > now, kyaValid: kyaOk },
    };
  }

  async getActivity(limit = 10): Promise<ToolResult> {
    const items = await this.p.reader.activity(this.account, Math.min(Math.max(limit, 1), 50));
    if (items.length === 0) return { text: 'No activity yet.', structured: { items } };
    return { text: items.map((i) => `${i.kind === 'refusal' ? 'Refused' : 'Done'}: ${i.reason} (${i.tier}) ${this.tx(i.txHash)}`).join('\n'), structured: { items } };
  }

  private async resolvePayee(payee: string): Promise<Address | null> {
    if (isAddress(payee)) return getAddress(payee);
    const labels = await this.p.labels(this.account);
    const want = payee.trim().toLowerCase();
    const hit = Object.entries(labels).find(([, l]) => l.toLowerCase() === want || l.toLowerCase().includes(want));
    return hit ? getAddress(hit[0]) : null;
  }

  private async payCalls(payee: string, amount: string): Promise<{ calls: Call[]; to: Address; amount6: bigint } | string> {
    const amount6 = parseUsd6(amount);
    if (amount6 === null) return 'amount must be a positive number of USDC with at most 6 decimals';
    const to = await this.resolvePayee(payee);
    if (!to) return `unknown payee "${payee}": use an address or a payee name from get_mandate`;
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount6] });
    return { calls: [{ to: this.p.tokens.usdc, value: 0n, data }], to, amount6 };
  }

  private async rebalanceCalls(sell: string, buy: string, amountUsd: string): Promise<{ calls: Call[]; amountIn: bigint; minOut: bigint; usd6: bigint } | string> {
    const tIn = this.tokenOf(sell);
    const tOut = this.tokenOf(buy);
    if (!tIn || !tOut) return `assets are ${SYMBOLS.join(', ')}`;
    if (tIn === tOut) return 'sell and buy must differ';
    const usd6 = parseUsd6(amountUsd);
    if (usd6 === null) return 'amountUsd must be a positive number';
    const policy = await this.p.reader.policy(this.account);
    const pIn = (await this.p.reader.price(tIn)).price8;
    const pOut = (await this.p.reader.price(tOut)).price8;
    const amountIn = (usd6 * 10n ** BigInt(this.decimals(tIn) + 2)) / pIn;
    // The hook's rule (DecisionLib._swap): minOut >= oracleOut * (1 - maxSlippage), oracleOut at the oracle price
    // without the desk's spread. The desk's quote (spread included) must still meet that floor.
    const usdIn = (amountIn * pIn) / 10n ** BigInt(this.decimals(tIn) + 2);
    const oracleOut = (usdIn * 10n ** BigInt(this.decimals(tOut) + 2)) / pOut;
    const minOut = (oracleOut * BigInt(10_000 - (policy?.maxSlippageBps ?? 100))) / 10_000n;
    const quoted = await this.p.reader.quote(tIn, tOut, amountIn);
    if (quoted < minOut) return `the desk price is beyond the mandate's slippage limit (${pct(policy?.maxSlippageBps ?? 100)}): not sent`;
    const calls: Call[] = [
      { to: tIn, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [this.p.tokens.desk, amountIn] }) },
      { to: this.p.tokens.desk, value: 0n, data: encodeFunctionData({ abi: TreasuryDeskAbi, functionName: 'swap', args: [tIn, tOut, amountIn, minOut] }) },
    ];
    return { calls, amountIn, minOut, usd6 };
  }

  /** Worst verdict of a batch: the first refusal, else OK. */
  private worst(v: Verdict[]): Verdict {
    return v.find((x) => x.reason !== Reason.OK) ?? v[0] ?? { reason: Reason.OK, tier: Tier.T1_AUTONOMOUS, callHash: `0x${'00'.repeat(32)}` };
  }

  async explain(a: { type: 'pay'; payee: string; amount: string } | { type: 'rebalance'; sell: string; buy: string; amountUsd: string }): Promise<ToolResult> {
    const built = a.type === 'pay' ? await this.payCalls(a.payee, a.amount) : await this.rebalanceCalls(a.sell, a.buy, a.amountUsd);
    if (typeof built === 'string') return { text: built, isError: true };
    const v = await this.p.reader.check(this.account, built.calls);
    const w = this.worst(v);
    const reasons = v.map((x) => reasonName(x.reason)).filter((r) => r !== 'OK');
    const tool = a.type === 'pay' ? 'pay' : 'rebalance';
    // What to do next depends on the tier, not on the reason: a T2 reason is lifted by the owner's approval, so the
    // model must submit to open the request (issue #4). Only T0 is final.
    const [verdict, next] =
      w.reason === Reason.OK ? ['would be done autonomously (T1).', 'submit'] as const
      : w.tier === Tier.T2_HUMAN ? [`needs the owner's approval: ${reasonName(w.reason)} (${tierName(w.tier)}). This is not a final refusal: submit it with ${tool} and the same arguments to create an approval request for the owner, then tell the user it is waiting for them.`, 'submit_for_approval'] as const
      : w.tier === Tier.T0_NEVER ? [`would be refused: ${reasonName(w.reason)} (${tierName(w.tier)}). This refusal is final: no approval can lift it. Do not retry it another way; tell the user.`, 'stop'] as const
      : [`would be refused: ${reasonName(w.reason)} (${tierName(w.tier)}). An approval request cannot lift it. Do not retry it another way; tell the user.`, 'stop'] as const;
    return { text: `Dry run: this ${a.type} ${verdict} Nothing was sent.`, structured: { reasons, tier: tierName(w.tier), next } };
  }

  /** Submit, whatever the dry run says: a refused op lands as evidence (I11). */
  private async act(calls: Call[], summary: string, done: (s: Submission) => string): Promise<ToolResult> {
    const v = await this.p.reader.check(this.account, calls);
    const w = this.worst(v);
    const s = await this.p.submit(this.account, calls);
    if (s.success) return { text: `${done(s)} Transaction: ${this.tx(s.txHash)}`, structured: { done: true, txHash: s.txHash, userOpHash: s.userOpHash } };
    const reason = reasonName(s.reasons[0] ?? w.reason);
    const links = `Refused operation: ${this.tx(s.txHash)}; refusal record: ${this.tx(s.refusalLogTx)}`;
    if (w.tier === Tier.T2_HUMAN) {
      const { id } = await this.p.approvals.request({ account: this.account, calls, callHash: w.callHash, reason, summary });
      return {
        text: `Not done yet: ${reason} needs the owner's approval. Request ${id} is waiting for the owner (WeChat or the web app). Do not retry with other amounts or payees; check it later with get_approval. ${links}`,
        structured: { done: false, approvalId: id, reason, tier: tierName(w.tier) },
      };
    }
    return {
      text: `Blocked: ${reason} (${tierName(w.tier)}). This decision is final. Do not retry this action another way; tell the user. ${links}`,
      structured: { done: false, reason, tier: tierName(w.tier), refusalLogTx: s.refusalLogTx },
      isError: true,
    };
  }

  async pay(a: { payee: string; amount: string; memo?: string }): Promise<ToolResult> {
    const built = await this.payCalls(a.payee, a.amount);
    if (typeof built === 'string') return { text: built, isError: true };
    const label = (await this.p.labels(this.account))[built.to.toLowerCase()] ?? built.to;
    return this.act(built.calls, `Pay ${usd(built.amount6)} USDC to ${label}${a.memo ? ` (${a.memo})` : ''}`, () => `Paid ${usd(built.amount6)} USDC to ${label}.`);
  }

  async rebalance(a: { sell: string; buy: string; amountUsd: string }): Promise<ToolResult> {
    const built = await this.rebalanceCalls(a.sell, a.buy, a.amountUsd);
    if (typeof built === 'string') return { text: built, isError: true };
    return this.act(built.calls, `Rebalance: sell ${usd(built.usd6)} USD of ${a.sell} for ${a.buy}`, () => `Sold ${usd(built.usd6)} USD of ${a.sell} for ${a.buy}.`);
  }

  /** An owner request only: a standing order exists on-chain only once the owner and the bank sign ADD_STANDING_ORDER. */
  async proposeStandingOrder(a: { payee?: string; merchant?: string; amount: string; period: 'weekly' | 'monthly' }): Promise<ToolResult> {
    if (!!a.payee === !!a.merchant) return { text: 'name either a payee (direct USDC) or a merchant code (paid through the payout partner)', isError: true };
    const amount = parseUsd6(a.amount);
    if (amount === null) return { text: 'amount must be a positive number of USDC with at most 6 decimals', isError: true };
    let payee: Address | undefined;
    let to = `merchant ${a.merchant}`;
    if (a.payee) {
      payee = (await this.resolvePayee(a.payee)) ?? undefined;
      if (!payee) return { text: `unknown payee "${a.payee}": use an address or a payee name from get_mandate`, isError: true };
      to = (await this.p.labels(this.account))[payee.toLowerCase()] ?? payee;
    }
    const summary = `${usd(amount)} USDC ${a.period} to ${to}`;
    const { id } = await this.p.proposals.standingOrder({ account: this.account, ...(payee ? { payee } : { merchant: a.merchant }), amount, period: a.period, summary });
    return { text: `Proposed to the owner (request ${id}): ${summary}. Nothing is set until the owner and the bank sign it.`, structured: { requestId: id } };
  }

  async triggerStandingOrder(id: number): Promise<ToolResult> {
    if (!this.p.standingOrders) return { text: 'Standing orders are not available yet.', isError: true };
    const r = await this.p.standingOrders.execute(this.account, id);
    return r.success
      ? { text: `Standing order ${id} executed. Transaction: ${this.tx(r.txHash)}`, structured: { txHash: r.txHash } }
      : { text: `Standing order ${id} was not executed (not due, cancelled, or refused by the mandate). Transaction: ${this.tx(r.txHash)}`, isError: true };
  }

  async getApproval(id: string): Promise<ToolResult> {
    const r = await this.p.approvals.get(this.account, id);
    if (!r) return { text: `No approval request ${id} for this account.`, isError: true };
    return { text: `Approval ${id}: ${String(r.state)}`, structured: r };
  }
}
