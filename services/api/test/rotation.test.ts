import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import { Rotation } from '../src/rotation.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const key = (v: number) => `0x${v.toString(16).padStart(40, 'a')}` as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;

function setup(onChain: Address) {
  const created: number[] = [];
  const r = new Rotation({
    agentKeyOf: async () => onChain,
    signerAddress: async (_a, v) => key(v),
    agentCreate: async (_a, v) => { created.push(v); return { agentKey: key(v) }; },
  });
  return { r, created };
}

describe('agent key rotation (F10 steps 3-4)', () => {
  it('creates the key version after the one Base holds for the account', async () => {
    const { r, created } = setup(key(2));
    expect(await r.rotate(ACCOUNT)).toEqual({ agentKey: key(3) });
    expect(created).toEqual([3]);
  });

  it('refuses an account without an agent, or whose agent key is none of its versions', async () => {
    await expect(setup(ZERO).r.rotate(ACCOUNT)).rejects.toThrow(/no agent/);
    await expect(setup('0x00000000000000000000000000000000000000bb').r.rotate(ACCOUNT)).rejects.toThrow(/none of/);
  });
});
