// I19 scan runner (spec 01): every log of Praetor's Base contracts from the deployment block to the head, the logs of
// the accounts their events name (the accounts' own events and their user operations at the EntryPoint), and the
// calldata of every transaction behind these logs, through the core (i19.ts). Read-only by construction: the
// collector gets four read actions of a viem public client and nothing else, no wallet or key is ever loaded, and
// the transport refuses any sending, signing or node-changing method and stops at a call budget.
// Not covered (no indexer): a transaction to a Praetor contract that reverted or left no log there.
// Usage: pnpm exec tsx scripts/checks/i19-scan.ts fork|live|m16 [--max-rpc N]   (make i19-scan ENV=... MAX_RPC=...)
// Log windows: BASE_LOGS_MAX_RANGE blocks (D98; 10,000 by default, publicnode accepts 50,000).
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeEventLog, http, type Abi, type AbiEvent, type Address, type EIP1193RequestFn, type Hex, type Transport } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { baseSepolia } from 'viem/chains';
import { mandateHookEventsAbi, payoutRailEventsAbi, refusalLogEventsAbi, standingOrdersEventsAbi, treasuryDeskEventsAbi } from '@praetor/protocol';
import { boundedGetLogs, loadDeployments, logsMaxRange, type Deployment } from '@praetor/chain';
import { scanBase, type LogItem, type TxItem } from './i19.js';

const PUBLIC_RPC = 'https://base-sepolia-rpc.publicnode.com';
const liveRpc = () => ({ url: process.env.BASE_LIVE_RPC_URL ?? PUBLIC_RPC, from: process.env.BASE_LIVE_RPC_URL ? 'BASE_LIVE_RPC_URL' : 'publicnode' });
export const ENVS: Record<string, { file: string; rpc: () => { url: string; from: string } }> = {
  fork: { file: 'infra/deployments/fork.json', rpc: () => ({ url: process.env.ANVIL_URL ?? 'http://127.0.0.1:18545', from: process.env.ANVIL_URL ? 'ANVIL_URL' : 'local anvil' }) },
  live: { file: 'infra/deployments/base-sepolia.json', rpc: liveRpc },
  m16: { file: 'infra/deployments/base-sepolia-m16.json', rpc: liveRpc },
};

export type Budget = { calls: number; readonly maxCalls: number };
const REFUSED = /^(eth_send|eth_sign|personal_|wallet_|anvil_|evm_|hardhat_)/;

/** The transport the scan talks through: no sending, signing or node-changing method, at most budget.maxCalls calls. */
export function guardedTransport(inner: Transport, budget: Budget): Transport {
  return (opts) => {
    const t = inner(opts);
    const request = (async (args: { method: string; params?: unknown }) => {
      if (REFUSED.test(args.method)) throw new Error(`i19-scan is read-only: ${args.method} refused`);
      if (budget.calls >= budget.maxCalls) throw new Error(`RPC budget of ${budget.maxCalls} calls reached`);
      budget.calls++;
      return t.request(args as never);
    }) as EIP1193RequestFn;
    return { ...t, request };
  };
}

type RawLog = { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };
/** The only actions the collector may use. */
export type ReadClient = {
  getChainId: () => Promise<number>;
  getBlockNumber: (a?: { cacheTime?: number }) => Promise<bigint>;
  getLogs: (p: { address: Address; event?: AbiEvent; args?: Record<string, unknown>; fromBlock: bigint; toBlock: bigint }) => Promise<RawLog[]>;
  getTransaction: (p: { hash: Hex }) => Promise<{ hash: Hex; to: Address | null; input: Hex }>;
};

// Praetor's own contracts; the EntryPoint, Safe7579 adapter, launchpad and USDC are shared on Base Sepolia (their
// logs are everyone's) and bank, regulator and operator are the members' addresses.
const CONTRACT_KEYS = [
  'mandateHook', 'passkeyValidator', 'agentKeyValidator', 'standingOrders', 'refusalLog', 'payoutRail', 'treasuryDesk', 'priceOracle',
  'anchor', 'identityRegistry', 'compliance', 'txau', 'txag', 'paymaster', 'wecrossInbox', 'wecrossProxy', 'noOwner',
] as const;
export const praetorContracts = (d: Deployment): Address[] => CONTRACT_KEYS.flatMap((k) => (d[k] ? [d[k]!] : []));

/** The EntryPoint events whose second indexed argument is the user operation's sender (UserOperationEvent, AccountDeployed, the revert reasons, prefund too low). */
export const SENDER_EVENTS = entryPoint07Abi.filter((x): x is Extract<(typeof entryPoint07Abi)[number], { type: 'event' }> =>
  x.type === 'event' && x.inputs.filter((i) => i.indexed)[1]?.name === 'sender') as readonly AbiEvent[];

const ACCOUNT_EVENTS = [...mandateHookEventsAbi, ...refusalLogEventsAbi, ...standingOrdersEventsAbi, ...payoutRailEventsAbi, ...treasuryDeskEventsAbi] as Abi;

/** The accounts Praetor's events name (their `account` argument), lowercased, in first-seen order. */
export function accountsOf(logs: RawLog[]): Address[] {
  const out = new Set<Address>();
  for (const l of logs) {
    try {
      const { args } = decodeEventLog({ abi: ACCOUNT_EVENTS, topics: l.topics as [Hex, ...Hex[]], data: l.data }) as { args: { account?: Address } };
      if (args.account) out.add(args.account.toLowerCase() as Address);
    } catch {
      // an event without an account (prices, anchors, heartbeats, token transfers)
    }
  }
  return [...out];
}

export async function collect(client: ReadClient, d: Deployment, o: { maxRange: bigint; budget?: Budget }) {
  const chainId = await client.getChainId();
  if (chainId !== d.chainId) throw new Error(`the node is on chain ${chainId}, the deployment on ${d.chainId}`);
  const to = await client.getBlockNumber({ cacheTime: 0 });
  const from = BigInt(d.deployBlock);
  // A numeric toBlock everywhere, so the windows never ask for the head again. One address per query and single topic
  // values: publicnode answers "Request blocked" to an address array.
  const getLogs = boundedGetLogs(client, o.maxRange);
  const range = { fromBlock: from, toBlock: to };
  const own: RawLog[] = [];
  for (const address of praetorContracts(d)) own.push(...(await getLogs({ address, ...range })));
  const accounts = accountsOf(own);
  const accountLogs: RawLog[] = [];
  const userOpLogs: RawLog[] = [];
  for (const a of accounts) accountLogs.push(...(await getLogs({ address: a, ...range })));
  for (const a of accounts) for (const event of SENDER_EVENTS) userOpLogs.push(...(await getLogs({ address: d.entryPoint, event, args: { sender: a }, ...range })));

  const byKey = new Map<string, RawLog>();
  for (const l of [...own, ...accountLogs, ...userOpLogs]) byKey.set(`${l.transactionHash}#${l.logIndex}`, l);
  const logs: LogItem[] = [...byKey.values()]
    .sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!)
    .map((l) => ({ address: l.address, transactionHash: l.transactionHash!, logIndex: l.logIndex!, topics: l.topics, data: l.data }));
  const counts = { contractLogs: own.length, accountLogs: accountLogs.length, userOpLogs: userOpLogs.length };
  const hashes = [...new Set(logs.map((l) => l.transactionHash))];
  const left = o.budget ? o.budget.maxCalls - o.budget.calls : Infinity;
  if (hashes.length > left) {
    throw new Error(`${logs.length} logs (contracts ${counts.contractLogs}, accounts ${counts.accountLogs}, EntryPoint ${counts.userOpLogs}), ${hashes.length} transactions to read, ${left} calls left in the budget: nothing scanned (raise --max-rpc)`);
  }
  const txs: TxItem[] = [];
  for (const hash of hashes) {
    const t = await client.getTransaction({ hash });
    txs.push({ hash: t.hash, to: t.to, input: t.input });
  }
  return { from, to, accounts, counts, items: { txs, logs } };
}

/** A finding's text, masked: on-chain data is public, but the scan's own output stays free of personal data. */
const mask = (s: string) => (s.length <= 2 ? '*'.repeat(s.length) : `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`);

async function main(argv: string[]) {
  const envName = argv[0] ?? 'fork';
  const env = ENVS[envName];
  if (!env) throw new Error(`usage: i19-scan.ts ${Object.keys(ENVS).join('|')} [--max-rpc N]`);
  const i = argv.indexOf('--max-rpc');
  const budget: Budget = { calls: 0, maxCalls: i > 0 ? Number(argv[i + 1]) : Infinity };
  if (!(budget.maxCalls > 0)) throw new Error('--max-rpc takes a positive number of calls');
  const d = loadDeployments(fileURLToPath(new URL(`../../${env.file}`, import.meta.url)));
  const { url, from: rpcFrom } = env.rpc();
  let httpRequests = 0;
  const client = createPublicClient({ chain: baseSepolia, transport: guardedTransport(http(url, { retryCount: 3, onFetchRequest: () => { httpRequests++; } }), budget) });
  const read: ReadClient = {
    getChainId: client.getChainId,
    getBlockNumber: client.getBlockNumber,
    getLogs: client.getLogs as unknown as ReadClient['getLogs'],
    getTransaction: client.getTransaction as unknown as ReadClient['getTransaction'],
  };
  const maxRange = logsMaxRange();
  console.log(`i19-scan ${envName}: ${env.file} (RPC ${rpcFrom}), log windows of ${maxRange} blocks`);
  const c = await collect(read, d, { maxRange, budget }).catch((e: Error) => {
    console.error(`i19-scan: ${e.message} (${budget.calls} JSON-RPC calls, ${httpRequests} HTTP requests)`);
    process.exit(1);
  });
  const r = scanBase(c.items);
  console.log(`  blocks ${c.from} to ${c.to}; ${praetorContracts(d).length} Praetor contracts, ${c.accounts.length} accounts named by their events`);
  console.log(`  logs: ${r.logs} (contracts ${c.counts.contractLogs}, accounts ${c.counts.accountLogs}, EntryPoint user operations ${c.counts.userOpLogs})`);
  console.log(`  transactions: ${r.txs}; ${r.bytes} bytes of calldata, topics and data scanned`);
  console.log(`  RPC: ${budget.calls} JSON-RPC calls, ${httpRequests} HTTP requests (retries included)`);
  for (const f of r.findings) console.log(`  FINDING ${f.rule} at ${f.where} offset ${f.offset}: ${mask(f.match)}`);
  if (r.findings.length) {
    console.error(`i19-scan: ${r.findings.length} findings`);
    process.exit(1);
  }
  console.log('i19-scan: no personal data found');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
