import { describe, it, expect, beforeEach } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from 'viem';
import { Reason, Tier, type Policy } from '@praetor/protocol';
import { PraetorTools, type Ports } from '../src/tools.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const USDC = '0x00000000000000000000000000000000000000a1' as Address;
const SHOP = '0x0000000000000000000000000000000000000402' as Address;
const ORIGIN = 'https://praetor.example';
const URL_OK = `${ORIGIN}/api/x402/market-brief`;
const TX = `0x${'bb'.repeat(32)}` as Hex;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const offer = (o: Record<string, unknown> = {}) => ({ scheme: 'praetor-mandate', network: 'eip155:84532', asset: USDC, amount: '1000000', payTo: SHOP, maxTimeoutSeconds: 600, extra: {}, ...o });
const required = (o: Record<string, unknown> = {}, error?: string) => ({ x402Version: 2, ...(error ? { error } : {}), resource: { url: URL_OK }, accepts: [offer(o)] });
const res402 = (body = required()) => new Response(JSON.stringify(body), { status: 402, headers: { 'PAYMENT-REQUIRED': b64(body) } });
const res200 = () => new Response('{"demo":true,"title":"Premium market brief"}', { status: 200, headers: { 'PAYMENT-RESPONSE': b64({ success: true, transaction: TX, network: 'eip155:84532', payer: ACCOUNT }) } });

let fetched: { url: string; headers: Headers; redirect?: string }[];
let answers: Response[];
let sent: { to: Address; data: Hex }[][];
let requested: unknown[];
let verdict: { reason: number; tier: number };
const policy = { hardCap: 2_000_000_000n, autoCap: 200_000_000n, dailyBudget: 500_000_000n, monthlyBudget: 3_000_000_000n, dailyCount: 10, bufferUsdc: 0n, payees: [SHOP] } as unknown as Policy;

const ports = (): Ports => ({
  tokens: { usdc: USDC, txau: '0x00000000000000000000000000000000000000a2', txag: '0x00000000000000000000000000000000000000a3', desk: '0x00000000000000000000000000000000000000d5' },
  explorer: 'https://sepolia.basescan.org',
  reader: {
    policy: async () => policy,
    check: async (_a: Address, calls: unknown[]) => calls.map(() => ({ ...verdict, callHash: `0x${'11'.repeat(32)}` as Hex })),
    status: async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 2_000_000_000n }),
    ownerHold: async () => ({ paused: false, recoveryPending: false }),
    spent: async () => ({ day: 0n, month: 0n, count: 0n, rebalances: 0n }),
    balances: async () => ({ [USDC]: 10_000_000n }),
    now: async () => 1_800_000_000n,
  } as unknown as Ports['reader'],
  submit: async (_account, calls) => {
    sent.push(calls);
    const ok = verdict.reason === Reason.OK;
    return { userOpHash: `0x${'aa'.repeat(32)}` as Hex, txHash: TX, success: ok, reasons: ok ? [] : [verdict.reason], refusalLogTx: ok ? null : (`0x${'cc'.repeat(32)}` as Hex) };
  },
  approvals: { request: async (r) => { requested.push(r); return { id: 'apr_1' }; }, get: async () => null },
  proposals: { standingOrder: async () => ({ id: 'x' }) },
  labels: async () => ({}),
  x402: {
    allowedOrigins: [ORIGIN],
    fetch: async (url, init) => {
      fetched.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
      return answers.shift() ?? new Response('no more answers', { status: 500 });
    },
  },
});
const tools = () => new PraetorTools(ACCOUNT, ports());
const proofOf = (h: Headers) => JSON.parse(Buffer.from(h.get('payment-signature') ?? '', 'base64').toString('utf8'));

beforeEach(() => { fetched = []; answers = []; sent = []; requested = []; verdict = { reason: Reason.OK, tier: Tier.T1_AUTONOMOUS }; });

describe('x402_fetch: SSRF guard', () => {
  for (const url of ['https://evil.example/x402', 'http://praetor.example/api/x402/market-brief', 'https://user:pw@praetor.example/api/x402/market-brief', 'https://praetor.example.evil.example/x', 'file:///etc/passwd', 'not a url']) {
    it(`refuses ${url} before any request or payment`, async () => {
      const r = await tools().x402Fetch({ url });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/not an allowed x402 merchant/);
      expect(fetched).toEqual([]);
      expect(sent).toEqual([]);
    });
  }
});

describe('x402_fetch', () => {
  it('returns a free resource as is, without paying', async () => {
    answers = [new Response('{"free":true}', { status: 200 })];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.text).toContain('{"free":true}');
    expect(sent).toEqual([]);
    expect(fetched[0]!.redirect).toBe('manual');
  });

  it('402: pays through the mandate (USDC.transfer to payTo), retries with the transaction as proof, returns the content and the link', async () => {
    answers = [res402(), res200()];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.isError).toBeFalsy();
    expect(sent).toHaveLength(1);
    const call = sent[0]![0]!;
    expect(call.to).toBe(USDC);
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data }).args).toEqual([getAddress(SHOP), 1_000_000n]);
    expect(fetched).toHaveLength(2);
    expect(proofOf(fetched[1]!.headers)).toMatchObject({ x402Version: 2, accepted: { scheme: 'praetor-mandate', network: 'eip155:84532' }, payload: { transaction: TX } });
    expect(r.text).toContain('Premium market brief');
    expect(r.text).toContain(`Transaction: https://sepolia.basescan.org/tx/${TX}`);
  });

  it('passes the mandate\'s answer through when the payment is not executed (a new payee waits for the owner), and does not retry', async () => {
    verdict = { reason: Reason.UNKNOWN_PAYEE, tier: Tier.T2_HUMAN };
    answers = [res402()];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.text).toMatch(/^Not done yet: UNKNOWN_PAYEE needs the owner's approval\. Request apr_1/);
    expect(requested).toHaveLength(1);
    expect(fetched).toHaveLength(1);
  });

  it('passes a T0 refusal through as final', async () => {
    verdict = { reason: Reason.SANCTIONED, tier: Tier.T0_NEVER };
    answers = [res402()];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Blocked: SANCTIONED \(T0_NEVER\)/);
    expect(fetched).toHaveLength(1);
  });

  it('refuses a price above the hard cap before paying', async () => {
    answers = [res402(required({ amount: '2000000001' }))];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/hard cap/);
    expect(sent).toEqual([]);
  });

  for (const [what, o] of [['another scheme', { scheme: 'exact' }], ['another chain', { network: 'eip155:1' }], ['another asset', { asset: SHOP }], ['a bad amount', { amount: '1.5' }]] as const) {
    it(`pays nothing for ${what}`, async () => {
      answers = [res402(required(o))];
      const r = await tools().x402Fetch({ url: URL_OK });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/nothing was paid/);
      expect(sent).toEqual([]);
    });
  }

  it('reports other HTTP answers (an error, a redirect, a 402 without header) without paying', async () => {
    answers = [new Response('boom', { status: 500 }), new Response(null, { status: 302, headers: { location: 'http://10.88.0.1/' } }), new Response('{}', { status: 402 })];
    for (const re of [/HTTP 500/, /HTTP 302/, /PAYMENT-REQUIRED/]) {
      const r = await tools().x402Fetch({ url: URL_OK });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(re);
    }
    expect(fetched).toHaveLength(3);
    expect(sent).toEqual([]);
  });

  it('says the payment went through when the merchant then refuses the proof (never pays twice)', async () => {
    answers = [res402(), res402(required({}, 'transaction too old'))];
    const r = await tools().x402Fetch({ url: URL_OK });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Paid.*transaction too old/s);
    expect(r.text).toContain(TX);
    expect(sent).toHaveLength(1);
  });

  it('with a transaction (an owner-approved payment that executed later), presents it as proof without paying again', async () => {
    answers = [res200()];
    const r = await tools().x402Fetch({ url: URL_OK, transaction: TX });
    expect(r.text).toContain('Premium market brief');
    expect(proofOf(fetched[0]!.headers).payload.transaction).toBe(TX);
    expect(sent).toEqual([]);
  });
});
