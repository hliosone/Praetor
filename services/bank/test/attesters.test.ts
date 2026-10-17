import { describe, it, expect } from 'vitest';
import { concat, keccak256, toHex, bytesToHex, type Hex } from 'viem';
import { AttesterChecks } from '../src/attesters.js';
import { NonceBook } from '../src/attestation.js';

const A = '0x00000000000000000000000000000000000a77e5';
function quote(addr: Hex, nonce: Hex, rtmr3 = `0x${'44'.repeat(48)}` as Hex) {
  const b = new Uint8Array(48 + 584);
  b.set(Buffer.from(rtmr3.slice(2), 'hex'), 48 + 472);
  b.set(Buffer.from(keccak256(concat([addr, nonce])).slice(2), 'hex'), 48 + 520);
  return bytesToHex(b);
}

describe('attester activation guard', () => {
  const make = () => new AttesterChecks({ nonces: new NonceBook(), mode: 'simulator', allowed: [] });

  it('signs an activation only for a verified attester and its measured value', async () => {
    const c = make();
    const nonce = c.nonce(A);
    const { measurement } = await c.verify(A, nonce, quote(A, nonce));
    expect(measurement).toBe(keccak256(`0x${'44'.repeat(48)}`));
    await expect(c.guard({ attester: A, measurement, active: true })).resolves.toBeUndefined();
    await expect(c.guard({ attester: A, measurement: keccak256(toHex('other')), active: true })).rejects.toThrow(/verified/);
  });

  it('refuses an unverified attester; a deactivation needs no quote', async () => {
    const c = make();
    await expect(c.guard({ attester: A, measurement: keccak256(toHex('m')), active: true })).rejects.toThrow(/verified/);
    await expect(c.guard({ attester: A, measurement: keccak256(toHex('m')), active: false })).resolves.toBeUndefined();
  });

  it('a nonce is used once and belongs to its attester', async () => {
    const c = make();
    const nonce = c.nonce(A);
    await c.verify(A, nonce, quote(A, nonce));
    await expect(c.verify(A, nonce, quote(A, nonce))).rejects.toThrow(/nonce/);
    const n2 = c.nonce(A);
    const B = '0x00000000000000000000000000000000000b77e5';
    await expect(c.verify(B, n2, quote(B, n2))).rejects.toThrow(/nonce/);
  });
});
