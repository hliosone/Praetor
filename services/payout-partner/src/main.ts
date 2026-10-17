// payout-partner entrypoint: watches PayoutRequested for this partner on Base and processes each payout once (a
// payout already settled or failed on the rail is skipped, so a restart resumes safely).
import pino from 'pino';
import { z } from 'zod';
import { parseAbiItem, type Hex } from 'viem';
import { PayoutRailAbi, baseClients, loadDeployments } from '@praetor/chain';
import { resolveKey } from '@praetor/config';
import { Rail } from '@praetor/protocol';
import { processPayout } from './partner.js';
import { alipayPlus, wechatPay } from './psp.js';
import { merchantOf } from './merchants.js';
import { createPartnerApp } from './app.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  ALIPAYPLUS_GATEWAY_URL: z.string().default('https://alipayplus-mock'),
  ALIPAYPLUS_CLIENT_ID: z.string().default('SANDBOX_PRAETOR_MOCK'),
  ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY: z.string().min(100),
  ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY: z.string().min(100),
  WECHATPAY_URL: z.string().url().default('http://wechatpay-mock:3300'),
  ALIPAYPLUS_MCP_COMMAND: z.string().optional(),
  PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  PORT: z.coerce.number().int().default(3310),
}).parse(process.env);

const log = pino();
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient: pub, walletClient: wallet } = baseClients(env.BASE_RPC_URL, resolveKey('PAYOUT_PARTNER_KEY', process.env));
const partner = wallet!.account!.address;
const write = async (functionName: 'withdraw' | 'settle' | 'fail', args: readonly unknown[]) => {
  const hash = await wallet!.writeContract({ address: d.payoutRail, abi: PayoutRailAbi, functionName, args: args as never, account: wallet!.account!, chain: wallet!.chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
};
const psp = {
  [Rail.ALIPAY_PLUS]: alipayPlus({ gatewayUrl: env.ALIPAYPLUS_GATEWAY_URL, clientId: env.ALIPAYPLUS_CLIENT_ID, merchantPrivateKey: env.ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY, alipayPublicKey: env.ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY, publicUrl: env.PUBLIC_URL, ...(env.ALIPAYPLUS_MCP_COMMAND ? { command: env.ALIPAYPLUS_MCP_COMMAND, args: [] } : {}) }),
  [Rail.WECHAT_PAY]: wechatPay(env.WECHATPAY_URL),
};
const REQUESTED = parseAbiItem('event PayoutRequested(uint256 indexed id, address indexed account, address indexed partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)');
let from = BigInt(d.deployBlock);
let lastTick = 0;
const done: { id: string; result: string }[] = [];

async function tick() {
  const head = await pub.getBlockNumber();
  if (head < from) return;
  const logs = await pub.getLogs({ address: d.payoutRail, event: REQUESTED, args: { partner }, fromBlock: from, toBlock: head });
  for (const l of logs) {
    const id = l.args.id!;
    const p = (await pub.readContract({ address: d.payoutRail, abi: PayoutRailAbi, functionName: 'payoutOf', args: [id] })) as { state: number };
    if (Number(p.state) !== 1) continue; // only REQUESTED payouts
    const result = await processPayout({ id, account: l.args.account!, amount: l.args.amount!, rail: Number(l.args.rail), merchantRef: l.args.merchantRef as Hex, paymentRef: l.args.paymentRef as Hex }, {
      merchant: merchantOf, psp,
      rail: { withdraw: (i) => write('withdraw', [i]), settle: (i, ref) => write('settle', [i, ref]), fail: (i, code) => write('fail', [i, code]) },
    });
    done.unshift({ id: id.toString(), result });
    log.info({ id: id.toString(), result }, 'payout processed');
  }
  from = head + 1n;
}

async function loop() {
  try {
    await tick();
    lastTick = Date.now();
  } catch (e) {
    log.error({ error: (e as Error).message.split('\n')[0] }, 'payout tick failed');
  }
  setTimeout(loop, 3000);
}
void loop();

const app = createPartnerApp({ partner, healthy: () => Date.now() - lastTick < 30_000, processed: () => done.slice(0, 50) });
app.listen(env.PORT, () => log.info({ port: env.PORT, partner }, 'payout-partner (MOCK PSP) listening'));
