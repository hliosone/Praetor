import { describe, it, expect } from 'vitest';
import type { Address, PublicClient } from 'viem';
import type { Deployment } from '@praetor/chain';
import { baseEvents } from '../src/watch.js';

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const d = { mandateHook: addr(1), refusalLog: addr(2), standingOrders: addr(3), payoutRail: addr(4), treasuryDesk: addr(5), anchor: addr(6), deployBlock: 100 } as unknown as Deployment;

describe('audit writer: Base sources (D98)', () => {
  it('reads Base from the cursor to the head in windows of at most N blocks (AUDIT_FROM=deploy on a public RPC)', async () => {
    const ranges: [bigint, bigint][] = [];
    const pub = {
      getBlockNumber: async () => 25_099n,
      getBlock: async () => ({ timestamp: 1_800_000_000n }),
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => { ranges.push([fromBlock, toBlock]); return []; },
    } as unknown as PublicClient;
    expect(await baseEvents(pub, d, 100n, 25_099n, 10_000n)).toEqual([]);
    expect(ranges).toEqual([[100n, 10_099n], [10_100n, 20_099n], [20_100n, 25_099n]]);
  });
});
