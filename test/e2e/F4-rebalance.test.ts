// F4 (spec 06): a demo gold shock pushes tXAU above its band; the scheduler wakes the agent, which rebalances on its
// own (T1) through mcp, agent-signer and the bundler, and the weights come back into their bands (I15).
import { describe, it, expect, beforeAll } from 'vitest';
import { erc20Abi } from 'viem';
import { PriceOracleAbi } from '@praetor/chain';
import {
  bootstrapConsortium, createAccount, fund, setDemoPrices, lastAgentTurn, onboard, pub, scriptAgent, shockPrice, stack, waitFor, waitHeartbeat, type Account, type Stack,
} from '../../scripts/demo/lib.js';

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
  acc = await createAccount(s, `f4-${Date.now()}`);
  await onboard(s, acc);
  await fund(s, acc);
  await waitHeartbeat(s);
}, 600_000);

describe('F4 monitoring and rebalancing', () => {
  it('1-5: XAU +20% (DEMO) -> scheduler wakes the agent -> rebalance(sell tXAU, buy USDC, 650) T1 -> back in band', async () => {
    await scriptAgent(s, acc.address, [
      { tool: 'praetor_get_portfolio', args: {} },
      { tool: 'praetor_explain', args: { type: 'rebalance', sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
      { tool: 'praetor_rebalance', args: { sell: 'tXAU', buy: 'USDC', amountUsd: '650' } },
      { text: 'Sold 650 USD of gold: it was above its 35% max.' },
    ]);
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
