// Standing orders (spec 06 F7): the owner sets a fixed recurring payment with ADD_STANDING_ORDER (owner + bank); the
// agent can only propose one (an owner request stored here, never on-chain). A merchant order pays the payout partner
// on the merchant's rail with its merchantRef; names stay in the partner's directory and this database (I19).
import { randomUUID } from 'node:crypto';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { StandingOrdersAbi } from '@praetor/chain';
import { OwnerActionKind as K, Rail, type StandingOrder } from '@praetor/protocol';
import type { OwnerActions } from './owner-actions.js';

export const PERIOD_S = { weekly: 604_800, monthly: 2_592_000 } as const;
export type Period = keyof typeof PERIOD_S;
const ZERO32 = `0x${'00'.repeat(32)}` as Hex;

export type OnChainOrder = { id: number; payee: Address; amount: bigint; period: number; nextDue: bigint; rail: number; merchantRef: Hex; active: boolean };
export type Directory = { partner: Address; merchants: { code: string; name: string; rail: number; merchantRef: Hex }[] };

export type ProposalState = 'pending' | 'prepared' | 'dismissed';
export type ProposalRow = {
  id: string; account: string; payee: string | null; merchant: string | null; amount: string; period: Period; summary: string; state: ProposalState;
};

export interface ProposalStore {
  put(r: ProposalRow): Promise<void>;
  get(id: string): Promise<ProposalRow | undefined>;
  list(account: string): Promise<ProposalRow[]>;
  update(id: string, state: ProposalState): Promise<void>;
}

export class MemoryProposalStore implements ProposalStore {
  rows = new Map<string, ProposalRow>();
  async put(r: ProposalRow) { this.rows.set(r.id, { ...r }); }
  async get(id: string) { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  async list(account: string) { return [...this.rows.values()].filter((r) => r.account === account.toLowerCase()).map((r) => ({ ...r })); }
  async update(id: string, state: ProposalState) { const r = this.rows.get(id); if (r) r.state = state; }
}

export type StandingOrderDeps = {
  now(): Promise<bigint>;
  ownerActions: Pick<OwnerActions, 'prepare'>;
  standingOrders: Address;
  proposals: ProposalStore;
  /** The account's orders on-chain (StandingOrderSet ids, read back from the executor). */
  orders(account: Address): Promise<OnChainOrder[]>;
  /** The payout partner's merchant directory. */
  directory(): Promise<Directory>;
  bundler: { tx(to: Address, data: Hex): Promise<{ txHash: Hex | null; success: boolean }> };
  notify?(n: { account: Address; kind: string; text: string }): Promise<void>;
};

type Terms = { payee?: Address; merchant?: string; amount: bigint; period: Period; firstDue?: bigint };

export class StandingOrders {
  constructor(private readonly d: StandingOrderDeps) {}

  /** Prepares ADD_STANDING_ORDER for the owner to sign, from terms or from a pending proposal of this account. */
  async propose(account: Address, b: Partial<Terms> & { proposalId?: string }) {
    let terms: Terms;
    if (b.proposalId) {
      const p = await this.d.proposals.get(b.proposalId);
      if (!p || p.account !== account.toLowerCase()) throw new Error('unknown proposal');
      if (p.state !== 'pending') throw new Error('proposal not pending');
      terms = { payee: (p.payee ?? undefined) as Address | undefined, merchant: p.merchant ?? undefined, amount: BigInt(p.amount), period: p.period, firstDue: b.firstDue };
    } else {
      terms = { payee: b.payee, merchant: b.merchant, amount: b.amount ?? 0n, period: b.period ?? 'monthly', firstDue: b.firstDue };
    }
    const target = await this.target(terms);
    const ids = (await this.d.orders(account)).map((o) => o.id);
    const order: StandingOrder = {
      account, id: Math.max(0, ...ids) + 1, payee: target.payee, amount: terms.amount, period: PERIOD_S[terms.period],
      firstDue: terms.firstDue ?? (await this.d.now()), rail: target.rail, merchantRef: target.merchantRef,
    };
    const prepared = await this.d.ownerActions.prepare(account, { kind: K.ADD_STANDING_ORDER, account, order });
    if (b.proposalId) await this.d.proposals.update(b.proposalId, 'prepared');
    return { order, ...prepared };
  }

  private async target(t: Terms): Promise<{ payee: Address; rail: number; merchantRef: Hex }> {
    if (!!t.payee === !!t.merchant) throw new Error('a standing order names a payee or a merchant');
    if (t.amount <= 0n) throw new Error('amount must be positive');
    if (t.payee) return { payee: t.payee, rail: Rail.USDC_DIRECT, merchantRef: ZERO32 };
    const dir = await this.d.directory();
    const m = dir.merchants.find((x) => x.code === t.merchant);
    if (!m) throw new Error('unknown merchant');
    return { payee: dir.partner, rail: m.rail, merchantRef: m.merchantRef };
  }

  /** The agent's proposal (mcp): an owner request only, checked like an order but never sent on-chain. */
  async request(account: Address, b: { payee?: Address; merchant?: string; amount: bigint; period: Period; summary: string }) {
    await this.target(b);
    const row: ProposalRow = {
      id: randomUUID(), account: account.toLowerCase(), payee: b.payee ?? null, merchant: b.merchant ?? null, amount: b.amount.toString(), period: b.period, summary: b.summary, state: 'pending',
    };
    await this.d.proposals.put(row);
    await this.d.notify?.({ account, kind: 'standing_order_proposal', text: `Your agent proposes a standing order: ${b.summary}` }).catch(() => undefined);
    return { id: row.id };
  }

  async dismiss(account: Address, id: string) {
    const p = await this.d.proposals.get(id);
    if (!p || p.account !== account.toLowerCase()) throw new Error('unknown proposal');
    await this.d.proposals.update(id, 'dismissed');
  }

  async list(account: Address) {
    const [orders, dir, proposals] = await Promise.all([this.d.orders(account), this.d.directory().catch(() => null), this.d.proposals.list(account)]);
    const name = (ref: Hex) => dir?.merchants.find((m) => m.merchantRef.toLowerCase() === ref.toLowerCase())?.name ?? null;
    return { orders: orders.map((o) => ({ ...o, merchant: o.rail === Rail.USDC_DIRECT ? null : name(o.merchantRef) })), proposals };
  }

  /** Anyone may trigger; the executor pays only when due (twice in a period reverts NotDue). */
  trigger(account: Address, id: number) {
    return this.d.bundler.tx(this.d.standingOrders, encodeFunctionData({ abi: StandingOrdersAbi, functionName: 'execute', args: [account, id] }));
  }
}
