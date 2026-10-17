import { describe, it, expect } from 'vitest';
import type { Address, Hex } from 'viem';
import { SandboxFaucet, SANDBOX_USDC } from '../src/sandbox.js';

const A = '0x00000000000000000000000000000000000c0ffe' as Address;
const B = '0x00000000000000000000000000000000000b0b0b' as Address;

function setup(o: Partial<{ enabled: boolean; fork: boolean; perHour: number }> = {}) {
  const minted: { to: Address; amount: bigint }[] = [];
  let t = 1_000_000;
  const f = new SandboxFaucet({
    enabled: o.enabled ?? true, fork: o.fork ?? true, perHour: o.perHour ?? 2, now: () => t,
    mint: async (to, amount) => { minted.push({ to, amount }); return `0x${'aa'.repeat(32)}` as Hex; },
  });
  return { f, minted, later: (ms: number) => { t += ms; } };
}

describe('judges\' sandbox faucet (interim, D48)', () => {
  it('funds a sandbox account once with demo USDC', async () => {
    const { f, minted } = setup();
    expect(await f.fund(A, '1.2.3.4')).toEqual({ txHash: `0x${'aa'.repeat(32)}`, amount: SANDBOX_USDC.toString() });
    await expect(f.fund(A, '1.2.3.4')).rejects.toThrow(/already funded/);
    expect(minted).toEqual([{ to: A, amount: SANDBOX_USDC }]);
  });

  it('limits funding per client address per hour', async () => {
    const { f, later } = setup({ perHour: 1 });
    await f.fund(A, '1.2.3.4');
    await expect(f.fund(B, '1.2.3.4')).rejects.toThrow(/rate limit/);
    later(3_600_001);
    await f.fund(B, '1.2.3.4');
  });

  it('exists only when the sandbox is enabled, and mints only on the fork', async () => {
    await expect(setup({ enabled: false }).f.fund(A, 'x')).rejects.toThrow(/not enabled/);
    await expect(setup({ fork: false }).f.fund(A, 'x')).rejects.toThrow(/only on the fork/);
  });
});
