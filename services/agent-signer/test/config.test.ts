import { describe, it, expect } from 'vitest';
import { loadSignerConfig } from '../src/config.js';

const base = { SIGNER_HMAC_MCP: 'm'.repeat(64), SIGNER_HMAC_API: 'a'.repeat(64), SIGNER_HMAC_BANK: 'b'.repeat(64), PUBLIC_URL: 'https://praetor.localhost' };

describe('agent-signer config (I13)', () => {
  it('prod refuses simulator attestations', () => {
    expect(() => loadSignerConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'simulator' })).toThrow(/I13/);
  });
  it('prod with Phala attestations is accepted; local may use the simulator', () => {
    expect(loadSignerConfig({ ...base, PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala' }).simulator).toBe(false);
    expect(loadSignerConfig({ ...base, PRAETOR_ENV: 'local', ATTESTATION_MODE: 'simulator' }).simulator).toBe(true);
  });
  it('needs the three caller secrets', () => {
    expect(() => loadSignerConfig({ ATTESTATION_MODE: 'simulator' })).toThrow();
  });
  it('the MCP URL an agent DID may advertise comes from PUBLIC_URL', () => {
    expect(loadSignerConfig({ ...base, ATTESTATION_MODE: 'simulator' }).mcpUrl).toBe('https://praetor.localhost/mcp');
  });
});
