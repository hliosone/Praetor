import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { heartbeatOnce, serialized } from '../src/heartbeat.js';

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

describe('one heartbeat at a time (the board holds one open heartbeat proposal)', () => {
  it('a manual beat during the job waits for it instead of opening a second proposal', async () => {
    const log: string[] = [];
    let open = 0;
    const beat = serialized(async (who: string) => {
      if (open++ > 0) throw new Error('heartbeat proposal already open');
      log.push(`start ${who}`);
      await new Promise((r) => setTimeout(r, 20));
      log.push(`end ${who}`);
      open--;
      return who;
    });
    expect(await Promise.all([beat('job'), beat('manual')])).toEqual(['job', 'manual']);
    expect(log).toEqual(['start job', 'end job', 'start manual', 'end manual']);
  });

  it('a failed beat does not block the next one', async () => {
    let n = 0;
    const beat = serialized(async () => { if (n++ === 0) throw new Error('fisco down'); return 'ok'; });
    await expect(beat()).rejects.toThrow(/fisco down/);
    expect(await beat()).toBe('ok');
  });
});
