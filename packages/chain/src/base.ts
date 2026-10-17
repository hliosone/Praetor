// Base clients (fork or live) with receipt-block reads (from Alex's services/relayer/base.mjs).
import { createPublicClient, createWalletClient, http, parseEther, type PublicClient, type Hex, type Address } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export function baseClients(rpcUrl: string, key?: Hex) {
  const transport = http(rpcUrl, { retryCount: 3 });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = key ? createWalletClient({ chain: baseSepolia, transport, account: privateKeyToAccount(key) }) : undefined;
  return { publicClient, walletClient };
}

/** The only clock for deadlines and expiries: the latest Base block (the fork's clock moves with time warps). */
// Structural types: viem's chain-specific clients (OP stack formatters) are not assignable to PublicClient.
export async function baseNow(client: { getBlock(a: { blockTag: 'latest' }): Promise<{ timestamp: bigint }> }): Promise<bigint> {
  return (await client.getBlock({ blockTag: 'latest' })).timestamp;
}

/** The public RPC is load-balanced and a node may lag the receipt: block until reads see that block. */
export async function waitSynced(
  client: { getBlockNumber(a?: { cacheTime?: number }): Promise<bigint> },
  blockNumber: bigint,
  { intervalMs = 1000, attempts = 60 }: { intervalMs?: number; attempts?: number } = {},
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await client.getBlockNumber({ cacheTime: 0 })) >= blockNumber) return;
    } catch {
      // a lagging or failing node: try again
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`node did not reach block ${blockNumber}`);
}

/** The fork funds its own keys (no faucet); a no-op request on live is refused by the node. */
export async function fundOnFork(client: Pick<PublicClient, 'request'>, address: Address, eth = '1'): Promise<void> {
  await client.request({ method: 'anvil_setBalance' as never, params: [address, `0x${parseEther(eth).toString(16)}`] as never });
}
