// F7 (spec 06): recurring payments. The agent proposes rent (an owner request only); the owner signs
// ADD_STANDING_ORDER from it and the bank co-signs; the scheduler executes it when due; the payout partner pays
// "Kowloon Lettings" through the official Alipay+ MCP client against alipayplus-mock, then withdraws and settles.
// Also a WeChat Pay merchant, a second trigger in the same period (refused), and a declined payment (refunded).
// Step 7 (audit records) arrives with the audit writer in M11.
import { describe, it, expect, beforeAll } from 'vitest';
import { encodeAbiParameters, erc20Abi, keccak256, parseAbiItem, type Address, type Hex } from 'viem';
import { PayoutRailAbi, baseNow } from '@praetor/chain';
import { merchantRef } from '@praetor/protocol';
import {
  PARTNER, agentChat, bootstrapConsortium, ensureDeskLiquidity, fund, linPolicy, pub, scriptAgent, setDemoPrices, stack, waitFor, type Stack,
} from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../scripts/demo/web.js';

let s: Stack;
let web: WebClient;
const tag = Date.now().toString(36);
const REQUESTED = parseAbiItem('event PayoutRequested(uint256 indexed id, address indexed account, address indexed partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)');
const usdc = (a: Address) => pub(s).readContract({ address: s.base.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const paymentRef = (id: number, period: bigint) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint32' }, { type: 'uint64' }], [web.account!, id, period]));
const STATE = { REQUESTED: 1, SETTLED: 2, FAILED: 3 } as const;

/** The payout this account requested with this paymentRef, once the partner has finished with it. */
async function payoutFor(ref: Hex, final: number) {
  let found: { id: bigint; state: number; withdrawn: boolean; merchantRef: Hex; amount: bigint } | undefined;
  await waitFor(`payout ${ref.slice(0, 10)} final`, async () => {
    const logs = await pub(s).getLogs({ address: s.base.payoutRail, event: REQUESTED, args: { account: web.account! }, fromBlock: BigInt(s.base.deployBlock), toBlock: 'latest' });
    const l = logs.find((x) => x.args.paymentRef === ref);
    if (!l) return false;
    const p = (await pub(s).readContract({ address: s.base.payoutRail, abi: PayoutRailAbi, functionName: 'payoutOf', args: [l.args.id!] })) as { state: number; withdrawn: boolean; merchantRef: Hex; amount: bigint };
    found = { id: l.args.id!, state: Number(p.state), withdrawn: p.withdrawn, merchantRef: p.merchantRef, amount: p.amount };
    return found.state === final;
  }, 120_000);
  return found!;
}

/** The owner turns terms (or the agent's proposal) into ADD_STANDING_ORDER and signs it; returns the order id. */
async function setOrder(body: Record<string, unknown>): Promise<number> {
  const p = await web.ok('POST', '/api/standing-orders/propose', body);
  const r = await web.ownerAction(p);
  if (!r.success) throw new Error('ADD_STANDING_ORDER failed');
  return p.order.id as number;
}

beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  web = new WebClient(s, `f7-${tag}`);
  const agentKey = await onboardViaApi(web, `f7-${tag}`, { fullName: `Zqf7person Rent${tag}`, birthdate: '1987-05-06', nationality: 'HK', documentNumber: `F7${tag}` });
  const p = { ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n };
  const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
  if (!(await web.ownerAction(prop)).success) throw new Error('policy not set');
  await fund(s, { address: web.account!, owner: web.passkey, agent: agentKey });
}, 900_000);

describe('F7 standing orders and the payout rail', () => {
  let rentId: number;

  it('1: the agent proposes the rent: an owner request only, nothing on-chain; the owner is notified', async () => {
    await scriptAgent(s, web.account!, [
      { tool: 'praetor_propose_standing_order', args: { merchant: 'KOWLOON-LETTINGS', amount: '1200', period: 'monthly' } },
      { text: 'I proposed the rent to you.' },
    ]);
    const t = await agentChat(s, web.account!, 'Set up my rent: 1200 USDC monthly to Kowloon Lettings');
    expect(String(t.tools.find((x) => x.tool === 'praetor_propose_standing_order')?.output)).toMatch(/Proposed to the owner/);
    const l = await web.ok('GET', '/api/standing-orders');
    expect(l.orders).toEqual([]);
    expect(l.proposals).toEqual([expect.objectContaining({ state: 'pending', merchant: 'KOWLOON-LETTINGS', amount: '1200000000', period: 'monthly' })]);
    const notes = await fetch(`http://10.88.0.81:3210/outbox/${web.account}`, { headers: { authorization: `Bearer ${s.env.INTERNAL_TOKEN_API}` } }).then((x) => x.json());
    expect(JSON.stringify(notes)).toMatch(/proposes a standing order: 1200.00 USDC monthly to merchant KOWLOON-LETTINGS/);
  }, 300_000);

  it('2-6: owner + bank set it; the scheduler executes it when due; Alipay+ (MCP client to the mock) pays, the partner settles', async () => {
    const before = { account: await usdc(web.account!), partner: await usdc(PARTNER(s)) };
    const { proposals } = await web.ok('GET', '/api/standing-orders');
    rentId = await setOrder({ proposalId: proposals[0].id });
    const l = await web.ok('GET', '/api/standing-orders');
    expect(l.orders).toEqual([expect.objectContaining({ id: rentId, merchant: 'Kowloon Lettings (mock)', amount: '1200000000', active: true })]);
    expect(l.proposals[0].state).toBe('prepared');
    // Nobody triggers it here: the scheduler sees it due (firstDue = now) and asks the executor.
    const p = await payoutFor(paymentRef(rentId, 0n), STATE.SETTLED);
    expect(p).toMatchObject({ withdrawn: true, merchantRef: merchantRef('KOWLOON-LETTINGS'), amount: 1_200_000_000n });
    expect(await usdc(web.account!)).toBe(before.account - 1_200_000_000n);
    expect(await usdc(PARTNER(s))).toBe(before.partner + 1_200_000_000n);
    const done = await fetch('http://10.88.0.43:3310/payouts').then((x) => x.json());
    expect(done.processed).toEqual(expect.arrayContaining([{ id: p.id.toString(), result: 'SETTLED' }]));
  }, 300_000);

  it('failure: triggered twice in a period, the executor refuses; nothing more is paid', async () => {
    const before = await usdc(web.account!);
    const r = await web.ok('POST', `/api/standing-orders/${rentId}/trigger`);
    expect(r.success).toBe(false);
    expect(await usdc(web.account!)).toBe(before);
  }, 120_000);

  it('a WeChat Pay merchant: settled through the WeChat Pay mock', async () => {
    const id = await setOrder({ merchant: 'HK-ELECTRIC', amount: '80', period: 'weekly' });
    const p = await payoutFor(paymentRef(id, 0n), STATE.SETTLED);
    expect(p).toMatchObject({ withdrawn: true, merchantRef: merchantRef('HK-ELECTRIC'), amount: 80_000_000n });
  }, 300_000);

  it('failure: the gateway declines the payment: the partner fails the payout and the account is refunded', async () => {
    const before = await usdc(web.account!);
    const id = await setOrder({ merchant: 'DECLINE-TEST', amount: '50', period: 'weekly' });
    const p = await payoutFor(paymentRef(id, 0n), STATE.FAILED);
    expect(p.withdrawn).toBe(false);
    expect(await usdc(web.account!)).toBe(before);
  }, 300_000);
});
