import { describe, it, expect } from 'vitest';
import { bankFlags } from '../src/main.js';

const base = { BASE_RPC_URL: 'http://anvil:8545', KYC_ENC_KEY: 'a'.repeat(64), KYC_VENDOR_HMAC: 'h'.repeat(64) };

describe('bank-service config (I13)', () => {
  it('prod refuses simulator attestations', () => {
    expect(() => bankFlags({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'simulator' })).toThrow(/I13/);
  });
  it('prod with Phala needs a compose-hash allowlist', () => {
    expect(() => bankFlags({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala' })).toThrow(/allowlist/);
    expect(bankFlags({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala', ALLOWED_COMPOSE_HASHES_AGENT: `0x${'ab'.repeat(32)}` }).allowedAgent).toEqual([`0x${'ab'.repeat(32)}`]);
  });
});
