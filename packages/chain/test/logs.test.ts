import { describe, it, expect } from 'vitest';
import { parseAbiItem, type Address, type PublicClient } from 'viem';
import { boundedGetLogs, logRanges, logsMaxRange, DEFAULT_LOGS_MAX_RANGE } from '../src/index.js';

const UPDATED = parseAbiItem('event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)');
const ORACLE = '0x0000000000000000000000000000000000000002' as Address;
type Range = { fromBlock: bigint; toBlock: bigint };

// A node that refuses ranges wider than `limit` blocks (publicnode: 50,000, sepolia.base.org: 200) and returns one log
// per block that is a multiple of 1,000, in chain order.
function node(head: bigint, limit: bigint) {
  const calls: Range[] = [];
  let heads = 0;
  const headArgs: unknown[] = [];
  const client = {
    getBlockNumber: async (a?: unknown) => { heads++; headArgs.push(a); return head; },
    getLogs: async (p: Range & { address: Address }) => {
      calls.push({ fromBlock: p.fromBlock, toBlock: p.toBlock });
      if (typeof p.fromBlock !== 'bigint' || typeof p.toBlock !== 'bigint') throw new Error('expected numeric bounds');
      if (p.toBlock - p.fromBlock + 1n > limit) throw new Error(`eth_getLogs is limited to a ${limit} range`);
      const logs = [];
      for (let b = p.fromBlock + ((1000n - (p.fromBlock % 1000n)) % 1000n); b <= p.toBlock; b += 1000n) logs.push({ blockNumber: b, address: p.address });
      return logs;
    },
  };
  return { client, calls, heads: () => heads, headArgs };
}

describe('Base log ranges (D98)', () => {
  it('splits [from, to] into inclusive windows of at most N blocks, in order', () => {
    expect(logRanges(0n, 23n, 10n)).toEqual([[0n, 9n], [10n, 19n], [20n, 23n]]);
    expect(logRanges(100n, 30_099n, 10_000n)).toEqual([[100n, 10_099n], [10_100n, 20_099n], [20_100n, 30_099n]]);
    expect(logRanges(5n, 5n, 10_000n)).toEqual([[5n, 5n]]);
    expect(logRanges(1n, 1n, 1n)).toEqual([[1n, 1n]]);
  });

  it('is empty when fromBlock is after toBlock', () => {
    expect(logRanges(6n, 5n, 10n)).toEqual([]);
  });

  it('refuses a window smaller than one block', () => {
    expect(() => logRanges(0n, 10n, 0n)).toThrow();
  });

  it('reads the widest range from BASE_LOGS_MAX_RANGE, 10,000 by default, and refuses anything but a positive integer', () => {
    expect(DEFAULT_LOGS_MAX_RANGE).toBe(10_000n);
    expect(logsMaxRange({})).toBe(10_000n);
    expect(logsMaxRange({ BASE_LOGS_MAX_RANGE: '' })).toBe(10_000n);
    expect(logsMaxRange({ BASE_LOGS_MAX_RANGE: '200' })).toBe(200n);
    for (const bad of ['0', '-5', '1e4', 'abc', '10000.5']) expect(() => logsMaxRange({ BASE_LOGS_MAX_RANGE: bad }), bad).toThrow(/BASE_LOGS_MAX_RANGE/);
  });
});

describe('bounded getLogs (D98)', () => {
  it('asks the node for windows of at most N blocks covering the whole range, and keeps the logs in chain order', async () => {
    const n = node(60_000n, 10_000n);
    const logs = await boundedGetLogs(n.client as unknown as PublicClient, 10_000n)({ address: ORACLE, event: UPDATED, fromBlock: 100n, toBlock: 45_000n });
    expect(n.calls).toEqual([
      { fromBlock: 100n, toBlock: 10_099n }, { fromBlock: 10_100n, toBlock: 20_099n }, { fromBlock: 20_100n, toBlock: 30_099n },
      { fromBlock: 30_100n, toBlock: 40_099n }, { fromBlock: 40_100n, toBlock: 45_000n },
    ]);
    expect(logs.map((l) => l.blockNumber)).toEqual(Array.from({ length: 45 }, (_, i) => BigInt((i + 1) * 1000)));
    expect(n.heads()).toBe(0);
  });

  it('resolves latest once, before the first window, from the node and not from the client cache', async () => {
    const n = node(25_000n, 10_000n);
    const logs = await boundedGetLogs(n.client as unknown as PublicClient, 10_000n)({ address: ORACLE, event: UPDATED, fromBlock: 1n, toBlock: 'latest' });
    expect(n.heads()).toBe(1);
    // A read right after a write must see the write's block, as `latest` sent to the node did (waitSynced does the same).
    expect(n.headArgs).toEqual([{ cacheTime: 0 }]);
    expect(n.calls).toEqual([{ fromBlock: 1n, toBlock: 10_000n }, { fromBlock: 10_001n, toBlock: 20_000n }, { fromBlock: 20_001n, toBlock: 25_000n }]);
    expect(logs).toHaveLength(25);
  });

  it('makes no log request for an empty range', async () => {
    const n = node(100n, 10_000n);
    expect(await boundedGetLogs(n.client as unknown as PublicClient, 10_000n)({ address: ORACLE, event: UPDATED, fromBlock: 101n, toBlock: 'latest' })).toEqual([]);
    expect(await boundedGetLogs(n.client as unknown as PublicClient, 10_000n)({ address: ORACLE, event: UPDATED, fromBlock: 50n, toBlock: 49n })).toEqual([]);
    expect(n.calls).toEqual([]);
  });

  it('passes the query through unchanged (address, event, args) in every window', async () => {
    const seen: unknown[] = [];
    const client = { getBlockNumber: async () => 0n, getLogs: async (p: Record<string, unknown>) => { seen.push(p); return []; } };
    await boundedGetLogs(client as unknown as PublicClient, 2n)({ address: ORACLE, event: UPDATED, args: { token: ORACLE }, fromBlock: 0n, toBlock: 3n, strict: false });
    expect(seen).toEqual([
      { address: ORACLE, event: UPDATED, args: { token: ORACLE }, fromBlock: 0n, toBlock: 1n, strict: false },
      { address: ORACLE, event: UPDATED, args: { token: ORACLE }, fromBlock: 2n, toBlock: 3n, strict: false },
    ]);
  });

  it('takes N from BASE_LOGS_MAX_RANGE when none is given', async () => {
    const before = process.env.BASE_LOGS_MAX_RANGE;
    process.env.BASE_LOGS_MAX_RANGE = '200';
    try {
      const n = node(1_000n, 200n);
      await boundedGetLogs(n.client as unknown as PublicClient)({ address: ORACLE, event: UPDATED, fromBlock: 1n, toBlock: 'latest' });
      expect(n.calls).toHaveLength(5);
      expect(n.calls.every((c) => c.toBlock - c.fromBlock + 1n <= 200n)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.BASE_LOGS_MAX_RANGE;
      else process.env.BASE_LOGS_MAX_RANGE = before;
    }
  });
});
