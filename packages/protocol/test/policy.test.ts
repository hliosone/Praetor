import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, keccak256, type Address } from 'viem';
import { encodePolicy, policyHash, validatePolicy, POLICY_RULES, POLICY_ABI, type Policy } from '../src/index.js';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const XAU = '0x00000000000000000000000000000000000000a1' as Address;
const XAG = '0x00000000000000000000000000000000000000a2' as Address;
const NOW = 1_800_000_000n;

// Lin's demo policy (spec 00).
export const lin = (): Policy => ({
  autoCap: 200_000_000n, hardCap: 2_000_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10,
  bufferUsdc: 1_000_000_000n,
  payees: ['0x00000000000000000000000000000000000000b1', '0x00000000000000000000000000000000000000b2', '0x00000000000000000000000000000000000000b3'],
  merchants: [],
  bands: [
    { token: USDC, minBps: 4000, targetBps: 5500, maxBps: 6000 },
    { token: XAU, minBps: 2000, targetBps: 3000, maxBps: 3500 },
    { token: XAG, minBps: 0, targetBps: 1500, maxBps: 1500 },
  ],
  maxRebalancesPerDay: 1, maxTradeUsd: 1_000_000_000n, maxSlippageBps: 100, validUntil: NOW + 86_400n * 365n, soterEnabled: true,
});

describe('policy encoding', () => {
  it('policyHash = keccak256(abi.encode(policy)) with the struct as one tuple', () => {
    const p = lin();
    expect(encodePolicy(p)).toBe(encodeAbiParameters(POLICY_ABI, [p]));
    expect(policyHash(p)).toBe(keccak256(encodePolicy(p)));
  });
});

describe('policy validation (same rules in Solidity)', () => {
  const v = (mut: (p: Policy) => void) => {
    const p = lin();
    mut(p);
    return validatePolicy(p, NOW, USDC);
  };

  it('accepts the demo policy', () => expect(v(() => {})).toBe('OK'));
  it('lists the rules in check order', () => {
    expect(POLICY_RULES).toEqual([
      'OK', 'AUTO_CAP_GT_HARD_CAP', 'DAILY_GT_MONTHLY', 'AMOUNT_TOO_LARGE', 'TOO_MANY_PAYEES', 'TOO_MANY_MERCHANTS',
      'BAND_COUNT', 'USDC_NOT_FIRST', 'BAND_ORDER', 'TARGET_SUM', 'ZERO_ADDRESS', 'DUPLICATE_PAYEE',
      'DUPLICATE_MERCHANT', 'DUPLICATE_TOKEN', 'BPS_RANGE', 'EXPIRED',
    ]);
  });
  it('autoCap <= hardCap', () => expect(v((p) => { p.autoCap = p.hardCap + 1n; })).toBe('AUTO_CAP_GT_HARD_CAP'));
  it('dailyBudget <= monthlyBudget', () => expect(v((p) => { p.dailyBudget = p.monthlyBudget + 1n; })).toBe('DAILY_GT_MONTHLY'));
  it('amounts <= 2^128', () => {
    expect(v((p) => { p.monthlyBudget = 2n ** 128n + 1n; p.dailyBudget = 1n; })).toBe('AMOUNT_TOO_LARGE');
    expect(v((p) => { p.bufferUsdc = 2n ** 128n + 1n; })).toBe('AMOUNT_TOO_LARGE');
    expect(v((p) => { p.maxTradeUsd = 2n ** 128n + 1n; })).toBe('AMOUNT_TOO_LARGE');
    expect(v((p) => { p.hardCap = 2n ** 128n; p.monthlyBudget = 2n ** 128n; })).toBe('OK');
  });
  it('at most 16 payees and 16 merchants', () => {
    const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1));
    expect(v((p) => { p.payees = many(17, (i) => `0x${i.toString(16).padStart(40, '0')}`) as Address[]; })).toBe('TOO_MANY_PAYEES');
    expect(v((p) => { p.merchants = many(17, (i) => `0x${i.toString(16).padStart(64, '0')}`) as `0x${string}`[]; })).toBe('TOO_MANY_MERCHANTS');
    expect(v((p) => { p.payees = many(16, (i) => `0x${i.toString(16).padStart(40, '0')}`) as Address[]; })).toBe('OK');
  });
  it('1 to 4 bands', () => {
    expect(v((p) => { p.bands = []; })).toBe('BAND_COUNT');
    expect(v((p) => { p.bands = [...p.bands, { token: '0x00000000000000000000000000000000000000a3', minBps: 0, targetBps: 0, maxBps: 0 }, { token: '0x00000000000000000000000000000000000000a4', minBps: 0, targetBps: 0, maxBps: 0 }]; })).toBe('BAND_COUNT');
  });
  it('USDC band first', () => expect(v((p) => { p.bands = [p.bands[1]!, p.bands[0]!, p.bands[2]!]; })).toBe('USDC_NOT_FIRST'));
  it('min <= target <= max <= 10000', () => {
    expect(v((p) => { p.bands[1]!.minBps = 3100; })).toBe('BAND_ORDER');
    expect(v((p) => { p.bands[1]!.maxBps = 2900; })).toBe('BAND_ORDER');
    expect(v((p) => { p.bands[0]!.maxBps = 10_001; })).toBe('BAND_ORDER');
  });
  it('targets sum to 10000', () => expect(v((p) => { p.bands[2]!.targetBps = 1400; })).toBe('TARGET_SUM'));
  it('no zero address payee or token', () => {
    expect(v((p) => { p.payees[0] = '0x0000000000000000000000000000000000000000'; })).toBe('ZERO_ADDRESS');
    expect(v((p) => { p.bands[1]!.token = '0x0000000000000000000000000000000000000000'; })).toBe('ZERO_ADDRESS');
  });
  it('no duplicates', () => {
    expect(v((p) => { p.payees[1] = p.payees[0]!; })).toBe('DUPLICATE_PAYEE');
    expect(v((p) => { p.merchants = [`0x${'1'.repeat(64)}`, `0x${'1'.repeat(64)}`]; })).toBe('DUPLICATE_MERCHANT');
    expect(v((p) => { p.bands[2]!.token = XAU; })).toBe('DUPLICATE_TOKEN');
  });
  it('maxSlippageBps <= 10000', () => expect(v((p) => { p.maxSlippageBps = 10_001; })).toBe('BPS_RANGE'));
  it('validUntil > now', () => {
    expect(v((p) => { p.validUntil = NOW; })).toBe('EXPIRED');
    expect(v((p) => { p.validUntil = NOW + 1n; })).toBe('OK');
  });
});
