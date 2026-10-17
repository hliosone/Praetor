import { describe, it, expect } from 'vitest';
import { concat, keccak256, toHex, bytesToHex, type Hex } from 'viem';
import { parseQuote, verifyTeeQuote, NonceBook } from '../src/attestation.js';

const ADDR = '0x00000000000000000000000000000000000a6e47';
const NONCE = keccak256(toHex('n'));
// A TDX v4 quote laid out like the simulator's: 48-byte header, TD report body (RTMR3 at 472, report data at 520).
function quote(reportData: Hex, rtmr3 = `0x${'33'.repeat(48)}` as Hex) {
  const b = new Uint8Array(48 + 584 + 100);
  b.set(Buffer.from(rtmr3.slice(2), 'hex'), 48 + 472);
  b.set(Buffer.from(reportData.slice(2).padEnd(128, '0'), 'hex'), 48 + 520);
  return bytesToHex(b);
}
const bound = keccak256(concat([ADDR, NONCE]));

describe('parseQuote', () => {
  it('reads the report data and RTMR3 at their TDX offsets', () => {
    const q = parseQuote(quote(bound));
    expect(q.reportData.slice(0, 66)).toBe(bound);
    expect(q.rtmr3).toBe(`0x${'33'.repeat(48)}`);
  });
  it('refuses a truncated quote', () => {
    expect(() => parseQuote('0x1234')).toThrow();
  });
});

describe('verifyTeeQuote', () => {
  it('simulator mode: accepts the bound report data; measurement = keccak256(RTMR3)', async () => {
    const r = await verifyTeeQuote({ quote: quote(bound), address: ADDR, nonce: NONCE, mode: 'simulator', allowed: [] });
    expect(r.measurement).toBe(keccak256(`0x${'33'.repeat(48)}`));
  });
  it('refuses report data bound to another address or nonce', async () => {
    await expect(verifyTeeQuote({ quote: quote(keccak256(concat([ADDR, keccak256(toHex('other'))]))), address: ADDR, nonce: NONCE, mode: 'simulator', allowed: [] })).rejects.toThrow(/report data/);
  });
  it('phala mode: needs the verifier to accept and the compose hash on the allowlist', async () => {
    const ok = async () => ({ verified: true, composeHash: `0x${'ab'.repeat(32)}` as Hex });
    const r = await verifyTeeQuote({ quote: quote(bound), address: ADDR, nonce: NONCE, mode: 'phala', allowed: [`0x${'ab'.repeat(32)}`], verifier: ok });
    expect(r.measurement).toBe(`0x${'ab'.repeat(32)}`);
    await expect(verifyTeeQuote({ quote: quote(bound), address: ADDR, nonce: NONCE, mode: 'phala', allowed: [`0x${'cd'.repeat(32)}`], verifier: ok })).rejects.toThrow(/compose hash/);
    await expect(verifyTeeQuote({ quote: quote(bound), address: ADDR, nonce: NONCE, mode: 'phala', allowed: [`0x${'ab'.repeat(32)}`], verifier: async () => ({ verified: false, composeHash: `0x${'ab'.repeat(32)}` as Hex }) })).rejects.toThrow(/not verified/);
    await expect(verifyTeeQuote({ quote: quote(bound), address: ADDR, nonce: NONCE, mode: 'phala', allowed: [`0x${'ab'.repeat(32)}`] })).rejects.toThrow(/verifier/);
  });
});

describe('NonceBook', () => {
  it('issues single-use nonces per subject that expire', () => {
    let t = 1000;
    const b = new NonceBook(() => t, 600);
    const n = b.issue('acct');
    expect(b.consume('other', n)).toBe(false);
    expect(b.consume('acct', n)).toBe(true);
    expect(b.consume('acct', n)).toBe(false);
    const m = b.issue('acct');
    t += 601;
    expect(b.consume('acct', m)).toBe(false);
  });
});

describe('quote encoding', () => {
  it('accepts a quote without the 0x prefix (dstack returns bare hex)', async () => {
    const q = quote(bound).slice(2);
    expect((await verifyTeeQuote({ quote: q, address: ADDR, nonce: NONCE, mode: 'simulator', allowed: [] })).measurement).toMatch(/^0x/);
  });
});
