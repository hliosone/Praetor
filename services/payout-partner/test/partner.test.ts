import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { processPayout, minorUnits, type PartnerDeps, type Payout } from '../src/partner.js';
import { Rail } from '@praetor/protocol';

const KOWLOON = keccak256(toHex('KOWLOON-LETTINGS'));
const payout = (o: Partial<Payout> = {}): Payout => ({ id: 7n, account: '0x00000000000000000000000000000000000c0ffe', amount: 1_200_000_000n, rail: Rail.ALIPAY_PLUS, merchantRef: KOWLOON, paymentRef: `0x${'ab'.repeat(32)}` as Hex, ...o });

function deps(outcome: 'SUCCESS' | 'FAIL' | 'UNKNOWN' = 'SUCCESS') {
  const calls: string[] = [];
  const d: PartnerDeps = {
    merchant: (ref) => (ref === KOWLOON ? { name: 'Kowloon Lettings (mock)', rail: Rail.ALIPAY_PLUS, mcc: '6513', region: 'HK', id: 'M0000000042' } : undefined),
    psp: {
      [Rail.ALIPAY_PLUS]: { pay: async (m, req) => { calls.push(`alipay:${m.name}:${req.minor}:${req.paymentRequestId}`); return outcome === 'UNKNOWN' ? { state: 'UNKNOWN' } : { state: outcome, settlementRef: 'pay-123' }; }, query: async () => { calls.push('query'); return { state: 'SUCCESS', settlementRef: 'pay-123' }; } },
      [Rail.WECHAT_PAY]: { pay: async () => ({ state: 'SUCCESS', settlementRef: 'wx-1' }), query: async () => ({ state: 'SUCCESS', settlementRef: 'wx-1' }) },
    },
    rail: {
      withdraw: async (id) => { calls.push(`withdraw:${id}`); },
      settle: async (id, ref) => { calls.push(`settle:${id}:${ref}`); },
      fail: async (id, code) => { calls.push(`fail:${id}:${code}`); },
    },
  };
  return { d, calls };
}

describe('payout partner (spec 05 F7 steps 5-6)', () => {
  it('USDC 6 decimals become USD cents', () => {
    expect(minorUnits(1_200_000_000n)).toBe(120_000);
    expect(minorUnits(12_345n)).toBe(1);
  });

  it('success: pays the merchant through the PSP, then withdraws and settles with the PSP reference', async () => {
    const { d, calls } = deps();
    expect(await processPayout(payout(), d)).toBe('SETTLED');
    expect(calls).toEqual(['alipay:Kowloon Lettings (mock):120000:praetor-payout-7', 'withdraw:7', `settle:7:${keccak256(toHex('pay-123'))}`]);
  });

  it('PSP failure: fail (the rail refunds the account), never withdraws', async () => {
    const { d, calls } = deps('FAIL');
    expect(await processPayout(payout(), d)).toBe('FAILED');
    expect(calls).toEqual(['alipay:Kowloon Lettings (mock):120000:praetor-payout-7', `fail:7:${keccak256(toHex('PSP_FAILED'))}`]);
  });

  it('an unclear outcome is resolved with a query before deciding (V7 trap 4)', async () => {
    const { d, calls } = deps('UNKNOWN');
    expect(await processPayout(payout(), d)).toBe('SETTLED');
    expect(calls).toContain('query');
  });

  it('an unknown merchant fails the payout', async () => {
    const { d, calls } = deps();
    expect(await processPayout(payout({ merchantRef: `0x${'00'.repeat(32)}` }), d)).toBe('FAILED');
    expect(calls).toEqual([`fail:7:${keccak256(toHex('UNKNOWN_MERCHANT'))}`]);
  });
});
