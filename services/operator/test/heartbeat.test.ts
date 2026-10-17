import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { heartbeatOnce } from '../src/heartbeat.js';

describe('operator heartbeat (spec 05, I4)', () => {
  it('opens a heartbeat valid until Base time + TTL and signs it itself', async () => {
    const calls: unknown[] = [];
    const consortium = {
      deadline: async () => 1_800_003_600n,
      open: async (board: string, fn: string, args: readonly unknown[]) => { calls.push({ board, fn, args }); return { proposalId: 9n, digest: keccak256(toHex('d')) as Hex, txHash: keccak256(toHex('t')) as Hex }; },
      sign: async (board: string, id: bigint) => { calls.push({ sign: board, id }); return { txHash: keccak256(toHex('s')) as Hex, ready: true }; },
    };
    const r = await heartbeatOnce(consortium as never, async () => 1_800_000_000n, 900);
    expect(r).toEqual({ proposalId: 9n, ready: true, validUntil: 1_800_000_900n });
    expect(calls).toEqual([{ board: 'status', fn: 'openHeartbeat', args: [1_800_000_900n, 1_800_003_600n] }, { sign: 'status', id: 9n }]);
  });
});
