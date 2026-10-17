import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, type Address, type Hex } from 'viem';
import { StandingOrdersAbi } from '@praetor/chain';
import { merchantRef, structHash, OwnerActionKind as K, Rail, STANDING_ORDER_TUPLE } from '@praetor/protocol';
import { OwnerActions } from '../src/owner-actions.js';
import { MemoryProposalStore, StandingOrders, PERIOD_S, type OnChainOrder } from '../src/standing-orders.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const SO = '0x00000000000000000000000000000000000000bb' as Address;
const PARTNER = '0x00000000000000000000000000000000000000cc' as Address;
const LANDLORD = '0x0000000000000000000000000000000000001a4d' as Address;
const NOW = 1_800_000_000n;

function setup(onChain: OnChainOrder[] = []) {
  const sent: { to: Address; data: Hex }[] = [];
  const notes: { text: string }[] = [];
  const ownerActions = new OwnerActions({
    domain: { name: 'Praetor-test', hook: HOOK }, now: async () => NOW, credIdHashOf: async () => `0x${'00'.repeat(32)}` as Hex,
    bank: { cosign: async () => ({ bankSig: '0xbb' as Hex }) }, bundler: { tx: async () => ({ txHash: null, success: true }) },
  });
  const so = new StandingOrders({
    now: async () => NOW, ownerActions, standingOrders: SO, proposals: new MemoryProposalStore(),
    orders: async () => onChain,
    directory: async () => ({ partner: PARTNER, merchants: [{ code: 'KOWLOON-LETTINGS', name: 'Kowloon Lettings (mock)', rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('KOWLOON-LETTINGS') }] }),
    bundler: { tx: async (to, data) => { sent.push({ to, data }); return { txHash: `0x${'11'.repeat(32)}` as Hex, success: true }; } },
    notify: async (n) => { notes.push(n); },
  });
  return { so, sent, notes };
}
const orderOf = (payload: Hex) => decodeAbiParameters([STANDING_ORDER_TUPLE], payload)[0];

describe('standing orders through the api (F7 steps 1-3)', () => {
  it('a merchant order pays the partner on its rail with the merchantRef; the owner signs ADD_STANDING_ORDER', async () => {
    const { so } = setup();
    const p = await so.propose(ACCOUNT, { merchant: 'KOWLOON-LETTINGS', amount: 1_200_000_000n, period: 'monthly' });
    const o = orderOf(p.payload);
    expect(o).toEqual({ account: ACCOUNT, id: 1, payee: PARTNER, amount: 1_200_000_000n, period: PERIOD_S.monthly, firstDue: NOW, rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('KOWLOON-LETTINGS') });
    expect(p.ownerAction.action).toBe(K.ADD_STANDING_ORDER);
    expect(p.ownerAction.payloadHash).toBe(structHash('StandingOrder', o));
  });

  it('a direct USDC order goes to the payee, with no merchant; ids follow the ones already on-chain', async () => {
    const { so } = setup([{ id: 4, payee: LANDLORD, amount: 1n, period: 60, nextDue: NOW, rail: 0, merchantRef: `0x${'00'.repeat(32)}`, active: false }]);
    const p = await so.propose(ACCOUNT, { payee: LANDLORD, amount: 50_000_000n, period: 'weekly', firstDue: NOW + 3600n });
    expect(orderOf(p.payload)).toMatchObject({ id: 5, payee: LANDLORD, rail: Rail.USDC_DIRECT, period: PERIOD_S.weekly, firstDue: NOW + 3600n, merchantRef: `0x${'00'.repeat(32)}` });
  });

  it('refuses an unknown merchant, both a payee and a merchant, or neither', async () => {
    const { so } = setup();
    await expect(so.propose(ACCOUNT, { merchant: 'NOPE', amount: 1n, period: 'monthly' })).rejects.toThrow(/unknown merchant/);
    await expect(so.propose(ACCOUNT, { merchant: 'KOWLOON-LETTINGS', payee: LANDLORD, amount: 1n, period: 'monthly' })).rejects.toThrow(/payee or a merchant/);
    await expect(so.propose(ACCOUNT, { amount: 1n, period: 'monthly' })).rejects.toThrow(/payee or a merchant/);
  });

  it('lists the on-chain orders with the merchant name (off-chain label) and the pending proposals', async () => {
    const { so } = setup([{ id: 1, payee: PARTNER, amount: 1_200_000_000n, period: PERIOD_S.monthly, nextDue: NOW, rail: Rail.ALIPAY_PLUS, merchantRef: merchantRef('KOWLOON-LETTINGS'), active: true }]);
    await so.request(ACCOUNT, { merchant: 'KOWLOON-LETTINGS', amount: 1_200_000_000n, period: 'monthly', summary: 'Rent' });
    const l = await so.list(ACCOUNT);
    expect(l.orders).toEqual([expect.objectContaining({ id: 1, merchant: 'Kowloon Lettings (mock)', amount: 1_200_000_000n, active: true })]);
    expect(l.proposals).toEqual([expect.objectContaining({ state: 'pending', merchant: 'KOWLOON-LETTINGS', amount: '1200000000', period: 'monthly' })]);
  });

  it("the agent's proposal is an owner request only (never on-chain, F7 step 1); the owner is notified", async () => {
    const { so, sent, notes } = setup();
    const { id } = await so.request(ACCOUNT, { merchant: 'KOWLOON-LETTINGS', amount: 1_200_000_000n, period: 'monthly', summary: 'Rent to Kowloon Lettings' });
    expect(sent).toHaveLength(0);
    expect(notes[0]!.text).toMatch(/Rent to Kowloon Lettings/);
    // The owner turns it into ADD_STANDING_ORDER: the fields come from the proposal, which is then marked prepared.
    const p = await so.propose(ACCOUNT, { proposalId: id });
    expect(orderOf(p.payload)).toMatchObject({ payee: PARTNER, amount: 1_200_000_000n, rail: Rail.ALIPAY_PLUS });
    expect((await so.list(ACCOUNT)).proposals[0]!.state).toBe('prepared');
    await expect(so.propose(ACCOUNT, { proposalId: id })).rejects.toThrow(/not pending/);
  });

  it('a proposal of another account cannot be used', async () => {
    const { so } = setup();
    const { id } = await so.request(ACCOUNT, { payee: LANDLORD, amount: 1n, period: 'weekly', summary: 'x' });
    await expect(so.propose('0x0000000000000000000000000000000000000bad', { proposalId: id })).rejects.toThrow(/unknown proposal/);
  });

  it('trigger asks the executor through the bundler (anyone may; the executor enforces nextDue)', async () => {
    const { so, sent } = setup();
    expect((await so.trigger(ACCOUNT, 3)).success).toBe(true);
    expect(sent[0]!.to).toBe(SO);
    expect(decodeFunctionData({ abi: StandingOrdersAbi, data: sent[0]!.data })).toMatchObject({ functionName: 'execute', args: [ACCOUNT, 3] });
  });
});
