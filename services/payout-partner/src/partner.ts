// payout-partner (spec 05, F7): a mock PSP that turns PayoutRequested into a merchant payment. Alipay+ goes through
// the official ant-intl-alipayplus-mcp server (as an MCP client), WeChat Pay through its mock. On success it takes
// the USDC (withdraw) and settles with the PSP reference; on failure it fails the payout, which refunds the account.
import { keccak256, toHex, type Hex } from 'viem';
import { Rail } from '@praetor/protocol';

export type Payout = { id: bigint; account: string; amount: bigint; rail: number; merchantRef: Hex; paymentRef: Hex; withdrawn?: boolean };
export type Merchant = { name: string; rail: number; mcc: string; region: string; id: string };
export type PspResult = { state: 'SUCCESS' | 'FAIL' | 'UNKNOWN'; settlementRef?: string };
export type Psp = {
  pay(m: Merchant, r: { paymentRequestId: string; minor: number; description: string }): Promise<PspResult>;
  query(m: Merchant, paymentRequestId: string): Promise<PspResult>;
};

export type PartnerDeps = {
  merchant(merchantRef: Hex): Merchant | undefined;
  psp: Record<number, Psp>;
  rail: { withdraw(id: bigint): Promise<void>; settle(id: bigint, ref: Hex): Promise<void>; fail(id: bigint, code: Hex): Promise<void> };
};

/** USDC (6 decimals) to USD minor units (cents). */
export const minorUnits = (amount: bigint) => Number(amount / 10_000n);
const code = (s: string) => keccak256(toHex(s));

export async function processPayout(p: Payout, d: PartnerDeps): Promise<'SETTLED' | 'FAILED'> {
  const m = d.merchant(p.merchantRef);
  const psp = m && m.rail === p.rail ? d.psp[p.rail] : undefined;
  if (!m || !psp) {
    await d.rail.fail(p.id, code('UNKNOWN_MERCHANT'));
    return 'FAILED';
  }
  const paymentRequestId = `praetor-payout-${p.id}`;
  let r = await psp.pay(m, { paymentRequestId, minor: minorUnits(p.amount), description: `Praetor payout ${p.id}` });
  for (let i = 0; r.state === 'UNKNOWN' && i < 10; i++) r = await psp.query(m, paymentRequestId);
  if (r.state !== 'SUCCESS') {
    await d.rail.fail(p.id, code(r.state === 'FAIL' ? 'PSP_FAILED' : 'PSP_UNKNOWN'));
    return 'FAILED';
  }
  // Already withdrawn: a restart came between withdraw and settle; withdrawing again would revert forever.
  if (!p.withdrawn) await d.rail.withdraw(p.id);
  await d.rail.settle(p.id, code(r.settlementRef ?? paymentRequestId));
  return 'SETTLED';
}

export { Rail };
