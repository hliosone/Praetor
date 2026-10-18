// Onboarding resumes at the first step the bank and Base do not show as done (issue #1: iOS Safari reloaded the tab
// during the KYC and the account was left without an agent or a policy).
import { describe, it, expect } from 'vitest';
import { resumeStep, type Progress } from './onboarding.js';

const KEY = '0x00000000000000000000000000000000000A9E01' as const;
const base: Progress = { deployed: true, kyc: { state: 'issued' }, riskProfile: 'balanced', kyaAgentKey: null, agentKey: null, policy: false };
const at = (p: Partial<Progress>) => resumeStep({ ...base, ...p });

describe('resumeStep', () => {
  it('a wallet not deployed yet resumes at the wallet, whatever else', () => {
    expect(at({ deployed: false, kyc: { state: 'none' }, riskProfile: null })).toBe('account');
  });

  it('KYC not started, open with the provider, refused or revoked resumes at the KYC', () => {
    for (const state of ['none', 'pending', 'rejected', 'revoked']) expect(at({ kyc: { state }, riskProfile: null }), state).toBe('kyc');
  });

  it('KYC verified without a profile resumes at the questions', () => {
    expect(at({ kyc: { state: 'verified' }, riskProfile: null })).toBe('suitability');
  });

  it('a profile (PersonKYC issued) without a KYA on Base resumes at the agent', () => {
    expect(at({})).toBe('agent');
  });

  it('the mandate on Base without the key installed resumes at the mandate (SET_AGENT_KEY only)', () => {
    expect(at({ kyaAgentKey: KEY })).toBe('mandate');
    // A key installed earlier that is not the KYA's (a rotation half done) still needs this one.
    expect(at({ kyaAgentKey: KEY, agentKey: '0x00000000000000000000000000000000000a9e02' })).toBe('mandate');
  });

  it('the KYA key installed (any case) and no policy resumes at the policy', () => {
    expect(at({ kyaAgentKey: KEY, agentKey: KEY.toLowerCase() as `0x${string}` })).toBe('policy');
  });

  it('a policy on Base means onboarding is done', () => {
    expect(at({ kyaAgentKey: KEY, agentKey: KEY, policy: true })).toBe('done');
    expect(at({ kyaAgentKey: KEY, agentKey: null, policy: true })).toBe('done');
  });
});
