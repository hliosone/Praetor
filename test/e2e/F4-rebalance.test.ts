// F4 (spec 06): a demo gold shock pushes tXAU above its band; the scheduler wakes the agent, which rebalances on its
// own (T1) through mcp, agent-signer and the bundler, and the weights come back into their bands (I15). Then a second
// rebalance the same day passes the mandate's daily count (REBALANCE_LIMIT, T2): the owner approves the swap with the
// passkey and the api has mcp resubmit the [approve, swap] batch, which consumes the approval (D103 fix 1, I5).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { erc20Abi, type Address, type Hex } from 'viem';
import { MandateHookAbi, PriceOracleAbi, baseNow } from '@praetor/chain';
import { callHash, digest, praetorDomain } from '@praetor/protocol';
import {
  agentChat, bootstrapConsortium, createAccount, ensureDeskLiquidity, fund, setDemoPrices, lastAgentTurn, linPolicy, onboard, pub, scriptAgent, shockPrice, stack, waitFor, waitHeartbeat, type Account, type Stack,
} from '../../scripts/demo/lib.js';
import { WebClient, onboardViaApi, policyJson } from '../../scripts/demo/web.js';

let s: Stack;
let acc: Account;

async function xauWeightBps(): Promise<number> {
  const p = pub(s);
  const bal = async (t: `0x${string}`) => p.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [acc.address] });
  const price = async (t: `0x${string}`) => ((await p.readContract({ address: s.base.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [t] })) as readonly [bigint, bigint])[0];
  const usd = await bal(s.base.usdc);
  const xau = ((await bal(s.base.txau)) * (await price(s.base.txau))) / 10n ** 20n;
  const xag = ((await bal(s.base.txag)) * (await price(s.base.txag))) / 10n ** 20n;
  return Number((xau * 10_000n) / (usd + xau + xag));
}

beforeAll(async () => {
  s = stack();
  // The consortium and the seeded prices this flow starts from (idempotent; a fresh fork has neither).
  await bootstrapConsortium(s);
  await setDemoPrices(s);
  await ensureDeskLiquidity(s);
  acc = await createAccount(s, `f4-${Date.now()}`);
  await onboard(s, acc);
  await fund(s, acc);
  await waitHeartbeat(s);
}, 600_000);

// The shock moves every account holding tXAU out of its band: restore the demo prices so later flows do not start
// in the middle of a wake storm (one opencode start per breached test account).
afterAll(async () => { await setDemoPrices(s); }, 120_000);

describe('F4 monitoring and rebalancing', () => {
  it('1-5: XAU +20% (DEMO) -> scheduler wakes the agent -> rebalance(sell tXAU, buy USDC, 650) T1 -> back in band', async () => {
    await scriptAgent(s, acc.address, [
      { tool: 'praetor_get_portfolio', args: {} },
      { tool: 'praetor_explain', args: { type: 'rebalance', sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
      { tool: 'praetor_rebalance', args: { sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
      { text: 'Sold 650 USD of gold: it was above its 35% max.' },
    ], 'wake');
    await shockPrice(s, 'XAU', 20);
    expect(await xauWeightBps()).toBeGreaterThan(3500);
    const turn = await waitFor('agent rebalance after the wake', async () => {
      const t = await lastAgentTurn(s, acc.address);
      return t && t.reason === 'BAND' && t.tools.some((x) => x.tool === 'praetor_rebalance') ? t : undefined;
    }, 300_000);
    const rb = turn.tools.find((x) => x.tool === 'praetor_rebalance')!;
    expect(String(rb.output)).toMatch(/Sold 650.00 USD of tXAU/);
    const w = await xauWeightBps();
    expect(w).toBeLessThanOrEqual(3500);
    expect(w).toBeGreaterThanOrEqual(2000);
  }, 420_000);
});

describe('F4 owner-approved rebalance', () => {
  const tag = Date.now().toString(36);
  let web: WebClient;
  const bal = (t: Address) => pub(s).readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [web.account!] });
  const rebalance = async (amountUsd: string) => {
    await scriptAgent(s, web.account!, [
      { tool: 'praetor_rebalance', args: { sell: 'tXAU', buy: 'USDC', amountUsd } },
      { text: `Selling ${amountUsd} USD of gold.` },
    ]);
    const t = await agentChat(s, web.account!, `Sell ${amountUsd} USD of gold for USDC`);
    return String(t.tools.find((x) => x.tool === 'praetor_rebalance')?.output);
  };

  // An owner who signs in to the api (the approval path), Lin's mandate (one rebalance a day), funded at the seeded
  // prices: put back first, the shock above holds tXAU at +20% until its afterAll.
  beforeAll(async () => {
    await setDemoPrices(s);
    web = new WebClient(s, `f4r-${tag}`);
    const agentKey = await onboardViaApi(web, `f4r-${tag}`, { fullName: `Zqf4person Rebalance${tag}`, birthdate: '1987-05-06', nationality: 'HK', documentNumber: `F4${tag}` });
    const p = { ...linPolicy(s, 0n), validUntil: (await baseNow(pub(s))) + 31_536_000n };
    const prop = await web.ok('POST', '/api/policy/propose', { policy: policyJson(p) });
    if (!(await web.ownerAction(prop)).success) throw new Error('policy not set');
    await fund(s, { address: web.account!, owner: web.passkey, agent: agentKey });
    await waitHeartbeat(s);
  }, 900_000);

  it('T2 REBALANCE_LIMIT: the second rebalance of the day, approved with the passkey, executes and consumes the approval', async () => {
    expect(await rebalance('100')).toMatch(/Sold 100.00 USD of tXAU/);
    const out = await rebalance('100');
    expect(out).toMatch(/REBALANCE_LIMIT needs the owner's approval/);
    const id = /Request ([0-9a-f-]{36})/.exec(out)![1]!;
    const r = await web.ok('GET', `/api/approvals/${id}`);
    expect(r.state).toBe('pending');
    expect(String(r.reason).split(',')[0]).toBe('REBALANCE_LIMIT');
    // The approval binds the swap, the call the hook decides on; the approve before it only inherits its verdict.
    expect(r.calls).toHaveLength(2);
    const swap = r.calls[1] as { to: Address; value: string; data: Hex };
    expect(swap.to.toLowerCase()).toBe(s.base.treasuryDesk.toLowerCase());
    const hash = callHash({ account: web.account!, target: swap.to, value: BigInt(swap.value), data: swap.data });
    expect(r.tier2.callHash).toBe(hash);
    const t2 = { account: r.tier2.account as Address, callHash: r.tier2.callHash as Hex, nonce: BigInt(r.tier2.nonce), expiresAt: BigInt(r.tier2.expiresAt) };
    expect(digest(praetorDomain(s.base.domainName, s.base.mandateHook), 'Tier2Approval', t2)).toBe(r.digest);
    const [xau, usdc] = [await bal(s.base.txau), await bal(s.base.usdc)];
    const res = await web.ok('POST', `/api/approvals/${id}/passkey`, { assertion: web.assert(r.digest) });
    expect(res.state).toBe('executed');
    expect(await bal(s.base.txau)).toBeLessThan(xau);
    expect(await bal(s.base.usdc)).toBeGreaterThan(usdc);
    const [, consumed] = (await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'approvalOf', args: [web.account!, hash] })) as readonly [bigint, boolean];
    expect(consumed).toBe(true);
    // I5: the same approval cannot be used again.
    expect((await web.call('POST', `/api/approvals/${id}/passkey`, { assertion: web.assert(r.digest) })).status).toBe(409);
  }, 420_000);
});
