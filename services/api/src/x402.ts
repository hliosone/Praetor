// A demo x402 merchant (D107): one paid resource behind the x402 v2 headers (PAYMENT-REQUIRED on the 402,
// PAYMENT-SIGNATURE on the retry, PAYMENT-RESPONSE on success, base64 JSON as in x402 v2), with Praetor's own scheme
// "praetor-mandate". The standard "exact" scheme needs an off-chain EIP-3009 signature from the payer, which Praetor
// makes impossible on purpose (I16). Here the agent pays first through its hook-checked operation, then proves it:
// the transaction hash must show a USDC Transfer from the account to payTo of at least the price, the hook's Decision
// (reason OK) for that exact transfer call, a recent block, and a hash never presented before.
import type express from 'express';
import { decodeEventLog, encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { callHash, mandateHookEventsAbi } from '@praetor/protocol';
import type { handler } from './app.js';

export const X402_NETWORK = 'eip155:84532';
export const X402_SCHEME = 'praetor-mandate';

export type Receipt = { status: 'success' | 'reverted'; blockNumber: bigint; logs: { address: Address; topics: Hex[]; data: Hex }[] };

export type X402Config = {
  usdc: Address;
  hook: Address;
  payTo: Address;
  /** The price in USDC base units (6 decimals). */
  amount: bigint;
  /** Oldest payment accepted, in seconds of Base time. */
  maxAgeS: number;
  resourceUrl: string;
  chain: { receipt(hash: Hex): Promise<Receipt | null>; blockTime(blockNumber: bigint): Promise<bigint>; now(): Promise<bigint> };
  brief(): Promise<unknown>;
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class X402Merchant {
  /** Hashes already served, or being checked. In memory: a restart forgets them, which maxAgeS bounds (D107). */
  private readonly used = new Set<string>();

  constructor(private readonly c: X402Config) {}

  required(error?: string) {
    return {
      x402Version: 2,
      ...(error ? { error } : {}),
      resource: { url: this.c.resourceUrl, description: 'Premium market brief for tXAU and tXAG (Praetor demo merchant, testnet only)', mimeType: 'application/json' },
      accepts: [{ scheme: X402_SCHEME, network: X402_NETWORK, asset: this.c.usdc, amount: this.c.amount.toString(), payTo: this.c.payTo, maxTimeoutSeconds: this.c.maxAgeS, extra: { proof: 'transaction hash of a USDC transfer that went through the Praetor mandate' } }],
    };
  }

  /** The payer of a valid proof, else why not. */
  async verify(header: string): Promise<{ payer: Address; transaction: Hex } | { error: string }> {
    let tx: string | undefined;
    try {
      const p = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { accepted?: { scheme?: string; network?: string }; payload?: { transaction?: string } };
      if (p.accepted?.scheme === X402_SCHEME && p.accepted.network === X402_NETWORK) tx = p.payload?.transaction;
    } catch { /* unreadable */ }
    if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return { error: 'unreadable payment: expected a praetor-mandate payload with a transaction hash' };
    const hash = tx.toLowerCase() as Hex;
    // Reserved before the first await: two requests with one hash cannot both pass.
    if (this.used.has(hash)) return { error: 'transaction already used' };
    this.used.add(hash);
    const r = await this.check(hash).catch(() => ({ error: 'transaction could not be checked' }));
    if ('error' in r) this.used.delete(hash);
    return r;
  }

  private async check(hash: Hex): Promise<{ payer: Address; transaction: Hex } | { error: string }> {
    const receipt = await this.c.chain.receipt(hash);
    if (!receipt) return { error: 'transaction not found' };
    if (receipt.status !== 'success') return { error: 'transaction failed' };
    // Only the logs of USDC itself and of the hook count: any contract can emit an event with the same signature.
    const transfers = receipt.logs.filter((l) => same(l.address, this.c.usdc)).flatMap((l) => {
      try {
        const e = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', topics: l.topics as [Hex, ...Hex[]], data: l.data });
        return [e.args];
      } catch {
        return [];
      }
    }).filter((t) => same(t.to, this.c.payTo) && t.value >= this.c.amount);
    if (transfers.length === 0) return { error: `no USDC transfer of at least ${this.c.amount} to ${this.c.payTo} in this transaction` };
    const decisions = receipt.logs.filter((l) => same(l.address, this.c.hook)).flatMap((l) => {
      try {
        const e = decodeEventLog({ abi: mandateHookEventsAbi, eventName: 'Decision', topics: l.topics as [Hex, ...Hex[]], data: l.data });
        return [e.args];
      } catch {
        return [];
      }
    });
    // The Decision of that exact call (USDC.transfer(payTo, value) by the account), allowed: proof it went through the mandate.
    const t = transfers.find((x) => {
      const ch = callHash({ account: x.from, target: this.c.usdc, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [x.to, x.value] }) });
      return decisions.some((d) => same(d.account, x.from) && same(d.callHash, ch) && d.reason === 0);
    });
    if (!t) return { error: 'the transfer did not go through the Praetor mandate (no allowed Decision of the hook for it)' };
    const age = (await this.c.chain.now()) - (await this.c.chain.blockTime(receipt.blockNumber));
    if (age > BigInt(this.c.maxAgeS)) return { error: `transaction too old (more than ${this.c.maxAgeS} s)` };
    return { payer: t.from, transaction: hash };
  }

  /** The content for a verified payment; if it cannot be built, the hash is released so the payer can try again. */
  async serve(transaction: Hex): Promise<unknown> {
    try {
      return await this.c.brief();
    } catch (e) {
      this.used.delete(transaction);
      throw e;
    }
  }
}

export function x402Routes(r: express.Router, h: typeof handler, m: X402Merchant) {
  r.get('/x402/market-brief', h(async (req, res) => {
    const header = req.header('payment-signature');
    const refuse = (error?: string) => {
      const body = m.required(error);
      res.status(402).set('PAYMENT-REQUIRED', b64(body)).json(body);
    };
    if (!header) return refuse();
    const v = await m.verify(header);
    if ('error' in v) return refuse(v.error);
    const body = await m.serve(v.transaction);
    res.set('PAYMENT-RESPONSE', b64({ success: true, transaction: v.transaction, network: X402_NETWORK, payer: v.payer })).json(body);
  }));
}

/** The paid content: a short brief from the PriceOracle prices, labelled as a demo. */
export function marketBrief(p: { xau: { price8: bigint; source: number }; xag: { price8: bigint; source: number } }, at: bigint) {
  const usd = (p8: bigint) => Number(p8) / 1e8;
  const src = (s: number) => (s === 1 ? 'DEMO price (not live market data)' : 'Pyth');
  const ratio = p.xag.price8 > 0n ? usd(p.xau.price8) / usd(p.xag.price8) : null;
  return {
    demo: true,
    merchant: 'Praetor demo merchant (x402, testnet only)',
    title: 'Premium market brief: tokenized gold and silver',
    asOf: new Date(Number(at) * 1000).toISOString(),
    tXAU: { usd: usd(p.xau.price8), source: src(p.xau.source) },
    tXAG: { usd: usd(p.xag.price8), source: src(p.xag.source) },
    goldSilverRatio: ratio === null ? null : Math.round(ratio * 100) / 100,
    note: 'Sample content for the x402 demo. Not investment advice.',
  };
}
