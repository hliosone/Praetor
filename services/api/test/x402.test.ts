import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { callHash, mandateHookEventsAbi } from '@praetor/protocol';
import { handler } from '../src/app.js';
import { X402Merchant, marketBrief, x402Routes, type Receipt } from '../src/x402.js';

const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e' as Address;
const HOOK = '0x00000000000000000000000000000000000000b0' as Address;
const PAY_TO = '0x0000000000000000000000000000000000000402' as Address;
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const TX = `0x${'ab'.repeat(32)}` as Hex;
const NOW = 1_800_000_000n;

const transferLog = (from: Address, to: Address, value: bigint, address: Address = USDC) => ({
  address,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [value]),
});
const decisionLog = (account: Address, to: Address, value: bigint, o: { address?: Address; reason?: number } = {}) => ({
  address: o.address ?? HOOK,
  topics: encodeEventTopics({
    abi: mandateHookEventsAbi, eventName: 'Decision',
    args: { account, callHash: callHash({ account, target: USDC, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, value] }) }) },
  }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }, { type: 'address' }, { type: 'uint256' }], [o.reason ?? 0, 1, USDC, value]),
});
const paid = (value = 1_000_000n): Receipt => ({ status: 'success', blockNumber: 7n, logs: [decisionLog(ACCOUNT, PAY_TO, value), transferLog(ACCOUNT, PAY_TO, value)] });

let receipt: Receipt | null;
let blockTime: bigint;
const merchant = () => new X402Merchant({
  usdc: USDC, hook: HOOK, payTo: PAY_TO, amount: 1_000_000n, maxAgeS: 600, resourceUrl: 'https://praetor.example/api/x402/market-brief',
  chain: { receipt: async () => receipt, blockTime: async () => blockTime, now: async () => NOW },
  brief: async () => ({ demo: true, title: 'Premium market brief' }),
});
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const unb64 = (s: string | undefined) => JSON.parse(Buffer.from(s ?? '', 'base64').toString('utf8'));
const proof = (transaction: string) => b64({ x402Version: 2, accepted: { scheme: 'praetor-mandate', network: 'eip155:84532' }, payload: { transaction } });

function app(m = merchant()) {
  const a = express();
  const r = express.Router();
  x402Routes(r, handler, m);
  a.use('/api', r);
  return a;
}

beforeEach(() => { receipt = paid(); blockTime = NOW - 30n; });

describe('x402 demo merchant (praetor-mandate scheme)', () => {
  it('answers 402 with an x402 v2 PAYMENT-REQUIRED for the praetor-mandate scheme on Base Sepolia', async () => {
    const r = await request(app()).get('/api/x402/market-brief').expect(402);
    const req = unb64(r.headers['payment-required']);
    expect(req).toMatchObject({
      x402Version: 2,
      resource: { url: 'https://praetor.example/api/x402/market-brief', mimeType: 'application/json' },
      accepts: [{ scheme: 'praetor-mandate', network: 'eip155:84532', asset: USDC, payTo: PAY_TO, amount: '1000000', maxTimeoutSeconds: 600 }],
    });
    expect(req.resource.description).toMatch(/demo/i);
    expect(req.error).toBeUndefined();
  });

  it('serves the resource with PAYMENT-RESPONSE for a USDC transfer that went through the mandate', async () => {
    const r = await request(app()).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', proof(TX)).expect(200);
    expect(r.body).toEqual({ demo: true, title: 'Premium market brief' });
    expect(unb64(r.headers['payment-response'])).toEqual({ success: true, transaction: TX, network: 'eip155:84532', payer: ACCOUNT });
  });

  it('refuses a transaction hash used before (replay)', async () => {
    const a = app();
    await request(a).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', proof(TX)).expect(200);
    const again = await request(a).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', proof(TX.toUpperCase().replace('0X', '0x'))).expect(402);
    expect(unb64(again.headers['payment-required']).error).toMatch(/already used/);
  });

  const refused: [string, () => void, RegExp][] = [
    ['an unreadable payment header', () => {}, /unreadable/],
    ['an unknown transaction', () => { receipt = null; }, /not found/],
    ['a reverted transaction', () => { receipt = { ...paid(), status: 'reverted' }; }, /failed/],
    ['a transfer below the price', () => { receipt = paid(999_999n); }, /no USDC transfer/],
    ['a transfer to someone else', () => { receipt = { ...paid(), logs: [decisionLog(ACCOUNT, ACCOUNT, 1_000_000n), transferLog(ACCOUNT, ACCOUNT, 1_000_000n)] }; }, /no USDC transfer/],
    ['a Transfer event from another contract', () => { receipt = { ...paid(), logs: [decisionLog(ACCOUNT, PAY_TO, 1_000_000n), transferLog(ACCOUNT, PAY_TO, 1_000_000n, HOOK)] }; }, /no USDC transfer/],
    ['a transfer without the hook\'s decision (not through the mandate)', () => { receipt = { ...paid(), logs: [transferLog(ACCOUNT, PAY_TO, 1_000_000n)] }; }, /mandate/],
    ['a Decision event from another contract', () => { receipt = { ...paid(), logs: [decisionLog(ACCOUNT, PAY_TO, 1_000_000n, { address: USDC }), transferLog(ACCOUNT, PAY_TO, 1_000_000n)] }; }, /mandate/],
    ['a decision for another call', () => { receipt = { ...paid(), logs: [decisionLog(ACCOUNT, PAY_TO, 5n), transferLog(ACCOUNT, PAY_TO, 1_000_000n)] }; }, /mandate/],
    ['an old transaction', () => { blockTime = NOW - 601n; }, /too old/],
  ];
  for (const [what, arrange, error] of refused) {
    it(`answers 402 again with an error for ${what}`, async () => {
      arrange();
      const header = what === 'an unreadable payment header' ? 'not base64 json!' : proof(TX);
      const r = await request(app()).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', header).expect(402);
      const req = unb64(r.headers['payment-required']);
      expect(req.error).toMatch(error);
      expect(req.accepts[0].scheme).toBe('praetor-mandate');
    });
  }

  it('a refused proof does not burn the hash: the same transaction can be presented once it is visible', async () => {
    const a = app();
    receipt = null;
    await request(a).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', proof(TX)).expect(402);
    receipt = paid();
    await request(a).get('/api/x402/market-brief').set('PAYMENT-SIGNATURE', proof(TX)).expect(200);
  });
});

describe('the paid market brief', () => {
  it('is built from the oracle prices, says when they are demo prices, and is labelled a demo', () => {
    const b = marketBrief({ xau: { price8: 318_000_000_000n, source: 1 }, xag: { price8: 3_180_000_000n, source: 0 } }, NOW);
    expect(b).toMatchObject({ demo: true, tXAU: { usd: 3180 }, tXAG: { usd: 31.8, source: 'Pyth' }, goldSilverRatio: 100, asOf: new Date(Number(NOW) * 1000).toISOString() });
    expect(b.tXAU.source).toMatch(/DEMO/);
  });
});
