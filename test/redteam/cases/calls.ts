// Small builders for case data (plain JSON values, the same a held-out file writes by hand).
import type { CallDataSpec, CallSpec } from '../lib/case.js';

export const transfer = (to: string, amount: string): CallSpec => ({ to: '$usdc', fn: 'transfer(address,uint256)', args: [to, amount] });
export const approve = (token: string, spender: string, amount: string): CallSpec => ({ to: token, fn: 'approve(address,uint256)', args: [spender, amount] });
export const swap = (tokenIn: string, tokenOut: string, amountIn: string, minOut: string): CallSpec => ({
  to: '$desk', fn: 'swap(address,address,uint256,uint256)', args: [tokenIn, tokenOut, amountIn, minOut],
});
/** PayoutRail.pay(partner, amount, rail, merchantRef, paymentRef); rail 1 = Alipay+. */
export const payout = (partner: string, amount: string, merchantRef = '$merchantKowloon'): CallSpec => ({
  to: '$rail', fn: 'pay(address,uint256,uint8,bytes32,bytes32)', args: [partner, amount, '1', merchantRef, '$paymentRef'],
});
export const exec = (...calls: CallSpec[]): CallDataSpec => ({ execute: { calls } });
export const execMode = (mode: string, calls: CallSpec[], trailing?: string): CallDataSpec => ({ execute: { mode, calls, ...(trailing ? { trailing } : {}) } });
