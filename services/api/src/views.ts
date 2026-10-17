// The owner's read views (spec 05: /api/portfolio, /status, /policy, /agent, /activity), from the chain through a
// reader: values in USD with 6 decimals, weights against the policy bands, statuses and profiles by name.
import type { Address, Hex } from 'viem';
import { PriceSource, RiskProfile, type Policy } from '@praetor/protocol';

export type Reader = {
  balances(account: Address): Promise<Record<string, bigint>>;
  price(token: Address): Promise<{ price8: bigint; publishTime: bigint; source: number }>;
  policy(account: Address): Promise<Policy | null>;
  status(account: Address): Promise<{ effective: number; account: number; global: number; heartbeatValidUntil: bigint }>;
  kya(account: Address): Promise<{ agentKey: Address; kycLevel: number; riskProfile: number; jurisdiction: Hex; validUntil: bigint }>;
  caps(account: Address): Promise<{ perTx: bigint; daily: bigint; monthly: bigint }>;
  spent(account: Address): Promise<{ day: bigint; month: bigint; count: bigint; rebalances: bigint }>;
  activity(account: Address, limit: number): Promise<unknown[]>;
  now(): Promise<bigint>;
};

const STATUS = ['ACTIVE', 'RESTRICTED', 'FROZEN'] as const;
const PROFILE = Object.keys(RiskProfile);
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

export class Views {
  constructor(private readonly d: { reader: Reader; tokens: { usdc: Address; txau: Address; txag: Address } }) {}

  async portfolio(account: Address) {
    const { usdc, txau, txag } = this.d.tokens;
    const [bal, policy, ...prices] = await Promise.all([this.d.reader.balances(account), this.d.reader.policy(account), ...[usdc, txau, txag].map((t) => this.d.reader.price(t))]);
    const rows = ([['USDC', usdc, 6], ['tXAU', txau, 18], ['tXAG', txag, 18]] as const).map(([symbol, token, dec], i) => {
      const balance = bal[token] ?? 0n;
      const value = (balance * prices[i]!.price8) / 10n ** BigInt(dec + 2);
      return { symbol, token, balance, value, demoPrice: symbol !== 'USDC' && prices[i]!.source === PriceSource.DEMO };
    });
    const total = rows.reduce((s, r) => s + r.value, 0n);
    return {
      totalUsd6: total.toString(),
      assets: rows.map((r) => ({
        symbol: r.symbol, token: r.token, balance: r.balance.toString(), valueUsd6: r.value.toString(), demoPrice: r.demoPrice,
        weightBps: total === 0n ? 0 : Number((r.value * 10_000n) / total),
        band: policy?.bands.find((b) => b.token.toLowerCase() === r.token.toLowerCase()) ?? null,
      })),
    };
  }

  async status(account: Address) {
    const [s, now] = await Promise.all([this.d.reader.status(account), this.d.reader.now()]);
    return { effective: STATUS[s.effective] ?? 'FROZEN', heartbeatValidUntil: s.heartbeatValidUntil.toString(), now: now.toString() };
  }

  async policy(account: Address) {
    const [policy, caps, spent] = await Promise.all([this.d.reader.policy(account), this.d.reader.caps(account), this.d.reader.spent(account)]);
    return json({ policy, caps, spent });
  }

  async agent(account: Address) {
    const k = await this.d.reader.kya(account);
    return {
      agentKey: k.agentKey, kycLevel: k.kycLevel, riskProfile: PROFILE[k.riskProfile] ?? 'NONE',
      jurisdiction: Buffer.from(k.jurisdiction.slice(2), 'hex').toString('latin1').replace(/\0/g, ''), validUntil: k.validUntil.toString(),
    };
  }

  async activity(account: Address, limit: number) {
    return { items: await this.d.reader.activity(account, limit) };
  }
}
