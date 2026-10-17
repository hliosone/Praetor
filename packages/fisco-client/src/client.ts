// FISCO BCOS 3.17.1 web3 RPC with its quirks handled once (spec 04; Alex's services/relayer/fisco.mjs, V2):
// legacy transactions with gasPrice 0, eth_getLogs only over windows of at most 10 blocks with address and topics,
// block.timestamp in milliseconds inside contracts, chain id 20200 (never used in our digests).
import {
  createPublicClient, createWalletClient, defineChain, http, type Abi, type AbiEvent, type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const FISCO_CHAIN_ID = 20200;
export const LEGACY_TX = { type: 'legacy', gasPrice: 0n } as const;
export const LOGS_MAX_SPAN = 10n;
export const FISCO_GAS = 30_000_000n;

export const fiscoChain = (rpcUrl: string) =>
  defineChain({ id: FISCO_CHAIN_ID, name: 'fisco-bcos', nativeCurrency: { name: 'none', symbol: 'NONE', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });

export function fiscoClients(rpcUrl: string, key?: Hex) {
  const chain = fiscoChain(rpcUrl);
  const transport = http(rpcUrl, { retryCount: 3 });
  const pub = createPublicClient({ chain, transport, cacheTime: 0 });
  const wallet = key ? createWalletClient({ chain, transport, account: privateKeyToAccount(key) }) : undefined;
  return { pub, wallet };
}

export const msToSeconds = (ms: bigint): bigint => ms / 1000n;

/** [from, to] as inclusive windows of at most 10 blocks: FISCO returns nothing beyond that span. */
export function logWindows(fromBlock: bigint, toBlock: bigint, span = LOGS_MAX_SPAN): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let a = fromBlock; a <= toBlock; a += span) out.push([a, a + span - 1n < toBlock ? a + span - 1n : toBlock]);
  return out;
}

export async function getLogsChunked<E extends AbiEvent>(
  client: Pick<PublicClient, 'getLogs'>,
  p: { address: Address; event: E; fromBlock: bigint; toBlock: bigint; args?: Record<string, unknown> },
) {
  const out = [];
  for (const [a, b] of logWindows(p.fromBlock, p.toBlock)) {
    out.push(...(await client.getLogs({ address: p.address, event: p.event, args: p.args as never, fromBlock: a, toBlock: b, strict: false } as never)));
  }
  return out as Awaited<ReturnType<typeof client.getLogs<E>>>;
}

/** A FISCO transaction: legacy, gasPrice 0, explicit gas, waits for the receipt and fails on revert. */
export async function sendFisco(pub: PublicClient, wallet: WalletClient, p: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) {
  const hash = await wallet.writeContract({ ...p, args: p.args ?? [], account: wallet.account!, chain: wallet.chain, gas: FISCO_GAS, ...LEGACY_TX } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`FISCO tx reverted: ${p.functionName} ${hash}`);
  return receipt;
}

export async function deployFisco(pub: PublicClient, wallet: WalletClient, abi: Abi, bytecode: Hex, args: readonly unknown[] = []): Promise<Address> {
  const hash = await wallet.deployContract({ abi, bytecode, args, account: wallet.account!, chain: wallet.chain, gas: FISCO_GAS, ...LEGACY_TX } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`FISCO deploy failed (${hash}): is the deployer whitelisted?`);
  return r.contractAddress;
}

/** Message kinds of the boards, by number: WeCrossInbox's args[0] and the relayer's type names. */
export const KIND_NAMES = ['Status', 'Heartbeat', 'Caps', 'KYA', 'Asset', 'Sanctions', 'Jurisdiction', 'Attester', 'Anchor'] as const;
