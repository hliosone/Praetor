import { describe, it, expect } from 'vitest';
import type { Address, PublicClient } from 'viem';
import { accountReader, type Deployment } from '../src/index.js';

const A = '0x00000000000000000000000000000000000c0ffe' as Address;
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const d = { mandateHook: addr(1), priceOracle: addr(2), treasuryDesk: addr(3), refusalLog: addr(4), usdc: addr(5), txau: addr(6), txag: addr(7), deployBlock: 100 } as unknown as Deployment;

function client(views: Record<string, unknown>, logs: Record<string, unknown[]> = {}) {
  return {
    getBlockNumber: async () => 5_000n,
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
    readContract: async ({ functionName }: { functionName: string }) => views[functionName],
    getLogs: async ({ event }: { event: { name: string } }) => logs[event.name] ?? [],
  } as unknown as PublicClient;
}

describe('account reader (shared by mcp and the api)', () => {
  it('reads status, the whole KYA, caps for its profile and spending', async () => {
    const r = accountReader(client({
      statusOf: [2, 2, 0, 1_800_000_120n], kyaOf: [addr(9), 2, 2, '0x484b', 1_900_000_000n], capsOf: [5n, 10n, 50n], spentOf: [1n, 2n, 3n, 0n],
    }), d);
    expect(await r.status(A)).toEqual({ effective: 2, account: 2, global: 0, heartbeatValidUntil: 1_800_000_120n });
    expect(await r.kya(A)).toEqual({ agentKey: addr(9), kycLevel: 2, riskProfile: 2, jurisdiction: '0x484b', validUntil: 1_900_000_000n });
    expect(await r.caps(A)).toEqual({ perTx: 5n, daily: 10n, monthly: 50n });
    expect(await r.spent(A)).toEqual({ day: 1n, month: 2n, count: 3n, rebalances: 0n });
  });

  it('has no policy when validUntil is zero', async () => {
    expect(await accountReader(client({ policyOf: { validUntil: 0n } }), d).policy(A)).toBeNull();
  });

  it('merges decisions and refusals, newest first', async () => {
    const r = accountReader(client({}, {
      Decision: [{ args: { reason: 0, tier: 1, target: addr(5), valueUsd6: 12_500_000n }, transactionHash: '0xa1', blockNumber: 10n }],
      Refused: [{ args: { reason: 1, tier: 4, target: addr(5) }, transactionHash: '0xb2', blockNumber: 20n }],
    }), d);
    expect(await r.activity(A, 10)).toEqual([
      { kind: 'refusal', reason: 'FROZEN', tier: 'T4_CONSORTIUM', target: addr(5), txHash: '0xb2' },
      { kind: 'decision', reason: 'OK', tier: 'T1_AUTONOMOUS', target: addr(5), txHash: '0xa1', valueUsd6: '12500000' },
    ]);
  });
});
