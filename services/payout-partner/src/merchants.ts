// The partner's merchant records (demo merchants, mock PSP accounts). Only their merchantRef goes on Base (I19); the
// api reads the directory (code, name, rail, merchantRef) to build standing orders, never the PSP account ids.
import type { Hex } from 'viem';
import { Rail, merchantRef } from '@praetor/protocol';
import type { Merchant } from './partner.js';

const DEMO: (Merchant & { code: string })[] = [
  { code: 'KOWLOON-LETTINGS', name: 'Kowloon Lettings (mock)', rail: Rail.ALIPAY_PLUS, mcc: '6513', region: 'HK', id: 'M0000000042' },
  { code: 'HK-ELECTRIC', name: 'HK Electric (mock)', rail: Rail.WECHAT_PAY, mcc: '4900', region: 'HK', id: 'WX0000000007' },
  // Scripted at alipayplus-mock: a merchant id starting with FAIL is declined, so the partner fails the payout (refund).
  { code: 'DECLINE-TEST', name: 'Decline test merchant (mock)', rail: Rail.ALIPAY_PLUS, mcc: '5999', region: 'HK', id: 'FAIL00000001' },
];

export const DIRECTORY = DEMO.map((m) => ({ code: m.code, name: m.name, rail: m.rail, merchantRef: merchantRef(m.code) }));

const byRef = new Map(DEMO.map((m) => [merchantRef(m.code).toLowerCase(), m]));
export const merchantOf = (ref: Hex): Merchant | undefined => byRef.get(ref.toLowerCase());
