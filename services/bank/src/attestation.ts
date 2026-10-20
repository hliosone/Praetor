// TEE quote checks for KYA (agent-signer) and attester registration (soter-attester), spec 05 and Q33. The report
// data must bind the TEE key to a nonce the bank issued. Prod: Phala's verifier and the compose-hash allowlist.
// Simulator (local only, refused in prod by I13): nothing in the quote says "simulator", so the mode comes from our
// own config and the measurement is the quote's RTMR3 as is.
import { randomBytes } from 'node:crypto';
import { concat, keccak256, sliceHex, size, type Hex } from 'viem';

// TDX quote v4: 48-byte header, then the TD report body; RTMR3 and REPORTDATA offsets within the body.
const HEADER = 48;
const RTMR3 = HEADER + 472;
const REPORT_DATA = HEADER + 520;

export function parseQuote(quote: string): { reportData: Hex; rtmr3: Hex } {
  const q = (quote.startsWith('0x') ? quote : `0x${quote}`) as Hex;
  if (size(q) < REPORT_DATA + 64) throw new Error('quote too short');
  return { reportData: sliceHex(q, REPORT_DATA, REPORT_DATA + 64), rtmr3: sliceHex(q, RTMR3, RTMR3 + 48) };
}

export type PhalaVerifier = (quote: string) => Promise<{ verified: boolean; composeHash: Hex }>;

export async function verifyTeeQuote(a: { quote: string; address: Hex; nonce: Hex; mode: 'simulator' | 'phala'; allowed: string[]; verifier?: PhalaVerifier }): Promise<{ measurement: Hex }> {
  const q = parseQuote(a.quote);
  if (sliceHex(q.reportData, 0, 32).toLowerCase() !== keccak256(concat([a.address, a.nonce])).toLowerCase()) throw new Error('report data does not bind this key and nonce');
  if (a.mode === 'simulator') return { measurement: keccak256(q.rtmr3) };
  if (!a.verifier) throw new Error('no Phala verifier configured');
  const v = await a.verifier(a.quote);
  if (!v.verified) throw new Error('quote not verified by Phala');
  if (!a.allowed.map((x) => x.toLowerCase()).includes(v.composeHash.toLowerCase())) throw new Error('compose hash not on the allowlist');
  return { measurement: v.composeHash };
}

/** Phala Cloud's public verifier (prod path; exercised in Phase C). */
export function phalaVerifier(fetchImpl: typeof fetch = fetch, url = 'https://cloud-api.phala.com/api/v1/attestations/verify'): PhalaVerifier {
  return async (quote) => {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hex: quote.replace(/^0x/, '') }) });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; quote?: { verified?: boolean; body?: { mr_config_id?: string } }; app_info?: { compose_hash?: string } };
    // Since 2026-10 the answer has no app_info: dstack writes 0x01 || compose hash into MRCONFIGID, which the quote
    // carries and the hardware measures.
    const mrConfig = /^(?:0x)?01([0-9a-f]{64})/i.exec(j.quote?.body?.mr_config_id ?? '')?.[1];
    const compose = j.app_info?.compose_hash ?? mrConfig ?? '';
    return { verified: r.ok && j.success !== false && j.quote?.verified === true, composeHash: (compose.startsWith('0x') ? compose : `0x${compose}`) as Hex };
  };
}

/** Single-use nonces per subject (an account, an attester), valid for `ttlS` seconds. */
export class NonceBook {
  private book = new Map<string, { subject: string; at: number }>();
  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000), private readonly ttlS = 600) {}
  issue(subject: string): Hex {
    const n = `0x${randomBytes(32).toString('hex')}` as Hex;
    this.book.set(n, { subject: subject.toLowerCase(), at: this.now() });
    return n;
  }
  consume(subject: string, nonce: string): boolean {
    const e = this.book.get(nonce);
    if (!e) return false;
    if (e.subject !== subject.toLowerCase()) return false;
    this.book.delete(nonce);
    return this.now() - e.at <= this.ttlS;
  }
}
