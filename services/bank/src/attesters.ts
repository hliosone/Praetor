// SOTER attester activation (spec 05, bank console): the bank co-signs an AttesterRegistry activation only for an
// attester whose TEE quote it verified, with the measurement taken from that quote. Deactivation needs no quote.
import type { Hex } from 'viem';
import { verifyTeeQuote, type NonceBook, type PhalaVerifier } from './attestation.js';

class Refused extends Error {
  status = 409;
}

export class AttesterChecks {
  private verified = new Map<string, Hex>();
  constructor(private readonly d: { nonces: NonceBook; mode: 'simulator' | 'phala'; allowed: string[]; verifier?: PhalaVerifier }) {}

  nonce(attester: string): Hex {
    return this.d.nonces.issue(`attester:${attester}`);
  }

  async verify(attester: Hex, nonce: Hex, quote: string): Promise<{ measurement: Hex }> {
    if (!this.d.nonces.consume(`attester:${attester}`, nonce)) throw new Refused('unknown, used or expired attester nonce');
    const r = await verifyTeeQuote({ quote, address: attester, nonce, mode: this.d.mode, allowed: this.d.allowed, verifier: this.d.verifier });
    this.verified.set(attester.toLowerCase(), r.measurement);
    return r;
  }

  async guard(message: unknown): Promise<void> {
    const m = message as { attester: string; measurement: string; active: boolean };
    if (!m.active) return;
    const v = this.verified.get(String(m.attester).toLowerCase());
    if (!v || v.toLowerCase() !== String(m.measurement).toLowerCase()) throw new Refused('attester quote not verified for this measurement');
  }
}
