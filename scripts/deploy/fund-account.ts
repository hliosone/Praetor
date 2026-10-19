// Funds one web-app account at small, explicit amounts (D99): USDC from the treasury, tXAU and tXAG minted by the desk
// operator at the oracle's prices (scripts/demo/lib.ts fund()). The amounts are what moves on chain, already at the
// live scale (D74, DEMO_SCALE=100: Lin's 5,300 USDC would be 53 there, more than the treasury holds). Fund only after
// the account's KYA: the metal tokens need a registered identity. Prints amounts and the address only.
// Usage: CHAIN_MODE=live pnpm exec tsx scripts/deploy/fund-account.ts <account> <usdc> <xauUsd> <xagUsd>
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import { fund, stack, type Account } from '../demo/lib.js';

/** Ceiling per call, in 6-decimal USD. The treasury holds about 10 USDC on live. The desk mints metals for free but
 *  buys them back with its few USDC on a rebalance, so metals stay at Lin's spec 00 proportions (5,300 / 3,200 /
 *  1,500) of a 10 USDC cash leg, and the account starts near its targets. */
const LIMITS = { usdc: 10_000_000n, xauUsd6: 6_000_000n, xagUsd6: 3_000_000n };
const USAGE = 'usage: fund-account.ts <account> <usdc> <xauUsd> <xagUsd> (on-chain USD, up to 6 decimals)';

const amount = (v: string, what: string, max: bigint): bigint => {
  if (!/^\d+(\.\d{1,6})?$/.test(v)) throw new Error(`${what}: not a plain amount (${USAGE})`);
  const n = parseUnits(v, 6);
  if (n > max) throw new Error(`${what}: ${v} is above the live ceiling of ${formatUnits(max, 6)}`);
  return n;
};

export function parseFundArgs(argv: string[]): { account: Address; usdc: bigint; xauUsd6: bigint; xagUsd6: bigint } {
  if (argv.length !== 4) throw new Error(USAGE);
  const [account, usdc, xau, xag] = argv as [string, string, string, string];
  if (!isAddress(account)) throw new Error(`account: not an address (${USAGE})`);
  const a = { account, usdc: amount(usdc, 'USDC', LIMITS.usdc), xauUsd6: amount(xau, 'tXAU', LIMITS.xauUsd6), xagUsd6: amount(xag, 'tXAG', LIMITS.xagUsd6) };
  if (a.usdc + a.xauUsd6 + a.xagUsd6 === 0n) throw new Error('nothing to fund');
  return a;
}

if (process.argv[1]?.endsWith('fund-account.ts')) {
  const a = parseFundArgs(process.argv.slice(2));
  const s = stack();
  console.log(`${s.set === 'LIVE' ? 'Base Sepolia' : 'fork'}: ${formatUnits(a.usdc, 6)} USDC, ${formatUnits(a.xauUsd6, 6)} USD of tXAU, ${formatUnits(a.xagUsd6, 6)} USD of tXAG to ${a.account}`);
  // fund() reads only the address.
  await fund(s, { address: a.account } as Account, a.usdc, a.xauUsd6, a.xagUsd6);
  console.log('funded');
}
