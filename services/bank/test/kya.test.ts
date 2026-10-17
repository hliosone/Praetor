import { describe, it, expect } from 'vitest';
import { keccak256, toHex, type Hex } from 'viem';
import { KyaBuilder } from '../src/kya.js';
import type { KycRecord } from '../src/kyc.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const AGENT = '0x00000000000000000000000000000000000a6e47';
const M = keccak256(toHex('rtmr3'));
const record: KycRecord = { userRef: 'u1', account: ACCOUNT, method: 'vendor', state: 'issued', jurisdiction: 'HK', kycLevel: 2, riskProfile: 'balanced', userWeId: 'did:weid:101:0x1', credentialHash: keccak256(toHex('kyc')) };

function builder(r: KycRecord | undefined = record) {
  return new KyaBuilder({ recordOf: async () => r });
}

describe('KYA built from the bank\'s own records (never from the caller)', () => {
  it('takes level, profile, jurisdiction and the PersonKYC hash from the KYC record, the key and measurement from the verified quote, the mandate from its countersignature', async () => {
    const b = builder();
    b.quoteVerified(ACCOUNT, AGENT, M);
    b.mandateSigned(ACCOUNT, { agentKey: AGENT, agentMeasurement: M, credentialHash: keccak256(toHex('mandate')) as Hex });
    const k = await b.build(ACCOUNT, { agentDidHash: keccak256(toHex('did')), validUntil: 2_000_000_000n });
    expect(k).toMatchObject({ account: ACCOUNT, agentKey: AGENT, kycLevel: 2, riskProfile: 2, jurisdiction: 'HK', agentMeasurement: M, kycCredentialHash: record.credentialHash, mandateCredentialHash: keccak256(toHex('mandate')) });
  });

  it('refuses without an issued PersonKYC, without a verified quote, or without a countersigned mandate', async () => {
    await expect(builder({ ...record, state: 'verified' }).build(ACCOUNT, { agentDidHash: M, validUntil: 1n })).rejects.toThrow(/PersonKYC/);
    const b = builder();
    await expect(b.build(ACCOUNT, { agentDidHash: M, validUntil: 1n })).rejects.toThrow(/quote/);
    b.quoteVerified(ACCOUNT, AGENT, M);
    await expect(b.build(ACCOUNT, { agentDidHash: M, validUntil: 1n })).rejects.toThrow(/mandate/);
  });

  it('refuses a mandate naming another key or measurement than the quote', async () => {
    const b = builder();
    b.quoteVerified(ACCOUNT, AGENT, M);
    b.mandateSigned(ACCOUNT, { agentKey: '0x00000000000000000000000000000000000000bb', agentMeasurement: M, credentialHash: M });
    await expect(b.build(ACCOUNT, { agentDidHash: M, validUntil: 1n })).rejects.toThrow(/mandate/);
    b.mandateSigned(ACCOUNT, { agentKey: AGENT, agentMeasurement: keccak256(toHex('other')), credentialHash: M });
    await expect(b.build(ACCOUNT, { agentDidHash: M, validUntil: 1n })).rejects.toThrow(/mandate/);
  });

  it('the measurement a mandate draft may carry is the verified one only', () => {
    const b = builder();
    expect(() => b.measurementFor(ACCOUNT, AGENT)).toThrow(/quote/);
    b.quoteVerified(ACCOUNT, AGENT, M);
    expect(b.measurementFor(ACCOUNT, AGENT)).toBe(M);
    expect(() => b.measurementFor(ACCOUNT, '0x00000000000000000000000000000000000000bb')).toThrow(/quote/);
  });
});
