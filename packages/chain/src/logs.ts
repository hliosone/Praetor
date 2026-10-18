// Base log reads in bounded windows (D98). Public Base Sepolia RPCs refuse wide eth_getLogs ranges (publicnode: 50,000
// blocks, sepolia.base.org: 200), and several services read from the deployment block, which falls 43,200 blocks
// further behind the head every day.

export const DEFAULT_LOGS_MAX_RANGE = 10_000n;

/** The widest log range asked of the Base RPC, in blocks: BASE_LOGS_MAX_RANGE, 10,000 when unset. */
export function logsMaxRange(env: Record<string, string | undefined> = process.env): bigint {
  const v = env.BASE_LOGS_MAX_RANGE;
  if (v === undefined || v === '') return DEFAULT_LOGS_MAX_RANGE;
  if (!/^[1-9][0-9]*$/.test(v)) throw new Error(`BASE_LOGS_MAX_RANGE must be a positive integer of blocks, got "${v}"`);
  return BigInt(v);
}

/** [from, to] as inclusive windows of at most max blocks, in order; empty when from is after to. */
export function logRanges(from: bigint, to: bigint, max: bigint): [bigint, bigint][] {
  if (max < 1n) throw new Error('a log window holds at least one block');
  const out: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += max) out.push([a, a + max - 1n < to ? a + max - 1n : to]);
  return out;
}

type LogsClient = { getLogs: (...a: never[]) => Promise<unknown>; getBlockNumber: (...a: never[]) => Promise<bigint> };

/**
 * The client's getLogs, same signature and results, asking the node for windows of at most maxRange blocks. A `latest`
 * (or missing) toBlock is resolved once, before the first window; windows run one after the other (public RPCs rate
 * limit), so the logs stay in chain order. A query without a numeric fromBlock (a block hash, a tag) goes through as is.
 */
export function boundedGetLogs<C extends LogsClient>(client: C, maxRange: bigint = logsMaxRange()): C['getLogs'] {
  if (maxRange < 1n) throw new Error('a log window holds at least one block');
  const getLogs = (p: Record<string, unknown>) => (client.getLogs as unknown as (p: Record<string, unknown>) => Promise<unknown[]>)(p);
  const bounded = async (p: Record<string, unknown> = {}) => {
    const { fromBlock, toBlock } = p;
    if (typeof fromBlock !== 'bigint' || !(typeof toBlock === 'bigint' || toBlock === 'latest' || toBlock === undefined)) return getLogs(p);
    // Uncached, like `latest` sent to the node: a read right after a write sees the write's block.
    const to = typeof toBlock === 'bigint' ? toBlock : await (client.getBlockNumber as (a: { cacheTime: number }) => Promise<bigint>)({ cacheTime: 0 });
    const out: unknown[] = [];
    for (const [a, b] of logRanges(fromBlock, to, maxRange)) out.push(...(await getLogs({ ...p, fromBlock: a, toBlock: b })));
    return out;
  };
  return bounded as unknown as C['getLogs'];
}
