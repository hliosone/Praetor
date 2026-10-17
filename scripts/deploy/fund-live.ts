// Spreads the LIVE deployer's Base Sepolia ETH to the other LIVE accounts that pay gas (QUESTIONS.md, Funding), up to
// each one's target, so the human funds one address. Testnet only: refuses any chain but 84532. Dry run unless
// --send. Prints addresses and amounts only, never a key.
// Usage: pnpm exec tsx scripts/deploy/fund-live.ts [--send]
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { parseEnv } from '../keys/lib.js';

// Lean targets for Base Sepolia at about 0.006 gwei (measured 2026-10-17): a handleOps bundle of about 1M gas costs
// 0.000006 ETH, so 0.003 ETH is hundreds of bundles. Deploy with PAYMASTER_DEPOSIT_WEI=4000000000000000 (0.004 ETH,
// about 1,600 sponsored operations) instead of the 0.02 default.
const TARGETS: [string, string][] = [
  ['BUNDLER_KEY', '0.003'], ['WECROSS_BASE_KEY', '0.001'], ['ORACLE_FEEDER_KEY', '0.001'],
  ['DESK_OPERATOR_KEY', '0.001'], ['PAYOUT_PARTNER_KEY', '0.0005'], ['TREASURY_KEY', '0.0005'],
];
/** What the deployer keeps: about 30M gas of contracts and the 0.004 ETH paymaster deposit, with margin. */
const DEPLOYER_KEEPS = parseEther('0.006');

const env = parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8'));
const rpc = env.BASE_LIVE_RPC_URL || 'https://sepolia.base.org';
const pub = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
if ((await pub.getChainId()) !== 84532) throw new Error('not Base Sepolia: refusing');
const deployer = privateKeyToAccount(env.LIVE_DEPLOYER_KEY as Hex);
const wallet = createWalletClient({ chain: baseSepolia, transport: http(rpc), account: deployer });
const send = process.argv.includes('--send');

let available = (await pub.getBalance({ address: deployer.address })) - DEPLOYER_KEEPS;
console.log(`deployer ${deployer.address}: ${formatEther(available + DEPLOYER_KEEPS)} ETH (keeps ${formatEther(DEPLOYER_KEEPS)})`);
for (const [name, target] of TARGETS) {
  const to = privateKeyToAccount(env[`LIVE_${name}`] as Hex).address;
  const missing = parseEther(target) - (await pub.getBalance({ address: to }));
  if (missing <= 0n) { console.log(`ok    ${name.replace(/_KEY$/, '')} ${to}`); continue; }
  if (missing > available) { console.log(`short ${name.replace(/_KEY$/, '')} ${to}: needs ${formatEther(missing)} ETH, deployer has ${formatEther(available > 0n ? available : 0n)} to spare`); continue; }
  if (send) {
    const hash = await wallet.sendTransaction({ to, value: missing });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`sent  ${formatEther(missing)} ETH to ${name.replace(/_KEY$/, '')} ${to}: ${hash}`);
  } else {
    console.log(`would send ${formatEther(missing)} ETH to ${name.replace(/_KEY$/, '')} ${to}`);
  }
  available -= missing;
}
