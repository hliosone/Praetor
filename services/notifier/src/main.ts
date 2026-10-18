// notifier entrypoint: the channels configured from env, and a watcher of the agent's on-chain decisions and refusals.
import pino from 'pino';
import { z } from 'zod';
import { parseAbiItem, type Address } from 'viem';
import { baseClients, loadDeployments } from '@praetor/chain';
import { BASESCAN_SEPOLIA, explorerFor, Tier } from '@praetor/protocol';
import { createNotifierApp, recoveryText, refusalText, type Channel } from './app.js';
import { webPushChannel, type PushSubscription } from './webpush.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  INTERNAL_TOKEN_API: z.string().min(32),
  OA_APPID: z.string().default(''),
  API_URL: z.string().url().default('http://api:3200'),
  VAPID_PUBLIC: z.string().default(''),
  VAPID_PRIVATE: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:team@praetor.localhost'),
  EXPLORER_URL: z.string().url().default(BASESCAN_SEPOLIA),
  CHAIN_MODE: z.enum(['fork', 'live']).default('fork'),
  PORT: z.coerce.number().int().default(3210),
}).parse(process.env);
// No public explorer knows the local fork (issue #9): messages then carry the hash marked local.
const explorer = explorerFor(env.CHAIN_MODE, env.EXPLORER_URL);

const log = pino();
// WeChat OA template messages need the OA test account and the user's OA openid (Phase C, B2): until they are sent for
// real, this channel only logs and says so in its name, whether OA_APPID is set or not.
const oaSink: Channel = { name: 'wechat-oa-sink', send: async (n) => { log.info({ account: n.account, kind: n.kind }, 'oa message'); } };
// Web push to the owner's devices: subscriptions are the api's (internal route); without VAPID keys the channel is off.
const push = env.VAPID_PUBLIC && env.VAPID_PRIVATE ? webPushChannel({
  vapid: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE },
  subscriptions: async (account) => {
    const r = await fetch(`${env.API_URL}/internal/push-subscriptions?account=${account}`, { headers: { authorization: `Bearer ${env.INTERNAL_TOKEN_API}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`api push subscriptions: ${r.status}`);
    return ((await r.json()) as { subscriptions: PushSubscription[] }).subscriptions;
  },
}) : null;
const app = createNotifierApp({ token: env.INTERNAL_TOKEN_API, channels: push ? [oaSink, push] : [oaSink] });
app.listen(env.PORT, () => log.info({ port: env.PORT, oa: !!env.OA_APPID }, 'notifier listening'));

// Refusals recorded on-chain (RefusalLog) become "Blocked: ..." messages (spec 06 F5 step 6). A recovery the bank
// scheduled on the hook (F10) reaches the owner's devices at once: the 48 h to cancel it are only worth something if
// the owner knows (the bank's own notice is a log sink, D13).
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient: pub } = baseClients(env.BASE_RPC_URL);
const REFUSED = parseAbiItem('event Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter)');
const RECOVERY = parseAbiItem('event RecoveryScheduled(address indexed account, bytes32 payloadHash, uint64 executableAt)');
let from = await pub.getBlockNumber();
const self = `http://127.0.0.1:${env.PORT}`;
const notify = (account: Address, kind: string, text: string) => fetch(`${self}/notify`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_API}` },
  body: JSON.stringify({ account, kind, text }),
});
setInterval(() => {
  (async () => {
    const head = await pub.getBlockNumber();
    if (head <= from) return;
    const range = { fromBlock: from + 1n, toBlock: head };
    const [logs, recoveries] = await Promise.all([
      pub.getLogs({ address: d.refusalLog, event: REFUSED, ...range }),
      pub.getLogs({ address: d.mandateHook, event: RECOVERY, ...range }),
    ]);
    from = head;
    for (const l of logs) {
      const tier = Number(l.args.tier);
      if (tier === Tier.T2_HUMAN) continue; // approvals are notified by the api with their request
      await notify(l.args.account as Address, 'refusal', refusalText({ reason: Number(l.args.reason), tier, target: String(l.args.target), txHash: l.transactionHash, explorer }));
    }
    for (const l of recoveries) await notify(l.args.account as Address, 'recovery', recoveryText({ executableAt: l.args.executableAt!, txHash: l.transactionHash, explorer }));
  })().catch((e) => log.error({ error: (e as Error).message.split('\n')[0] }, 'watch failed'));
}, 3000);
