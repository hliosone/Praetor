// Onboarding after a reload (issue #1): the page reads the session and the progress, and opens at the right step.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Progress } from '../lib/onboarding.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const KEY = '0x00000000000000000000000000000000000a9e01' as const;
let me: unknown = null;
let progress: Progress;
let kycStatus: unknown = { state: 'pending' };
const api = vi.fn(async (method: string, path: string) => {
  if (path === '/me') { if (!me) throw new Error('401'); return me; }
  if (path === '/onboarding/progress') return progress;
  if (path === '/onboarding/kyc/status') return kycStatus;
  throw new Error(`unexpected ${method} ${path}`);
});
const setAgentKey = vi.fn(async () => {});
vi.mock('../lib/api.js', () => ({ api: (...a: unknown[]) => api(...(a as [string, string])) }));
vi.mock('../lib/passkey.js', () => ({ assertDigest: vi.fn(), signAndSubmit: vi.fn(), signUp: vi.fn() }));
vi.mock('../lib/agent.js', () => ({ installAgent: vi.fn(), setAgentKey: (...a: unknown[]) => setAgentKey(...(a as [])) }));

const { Onboarding } = await import('./Onboarding.js');
const base: Progress = { deployed: true, kyc: { state: 'issued' }, riskProfile: 'balanced', kyaAgentKey: null, agentKey: null, policy: false };
const open = () => render(<MemoryRouter><Onboarding /></MemoryRouter>);
const current = () => document.querySelector('[aria-current="step"]')?.textContent;

afterEach(() => { cleanup(); me = null; kycStatus = { state: 'pending' }; api.mockClear(); });

describe('Onboarding resumes from the server', () => {
  it('without a session: the passkey step, and no progress read', async () => {
    open();
    await screen.findByRole('button', { name: 'onb.create' });
    expect(api).not.toHaveBeenCalledWith('GET', '/onboarding/progress');
  });

  it('KYC verified in the other tab: the questions, with their wording', async () => {
    me = { userId: 'u', email: 'a@example.com', account: ACCOUNT };
    progress = { ...base, kyc: { state: 'verified' }, riskProfile: null };
    open();
    await screen.findByRole('button', { name: 'onb.saveProfile' });
    expect(current()).toBe('onb.suitability');
    expect(screen.getByLabelText('1. onb.q1')).toBeTruthy();
  });

  it('KYC still open with the provider: waits for the decision and moves on when it is verified', async () => {
    me = { userId: 'u', email: 'a@example.com', account: ACCOUNT };
    progress = { ...base, kyc: { state: 'pending' }, riskProfile: null };
    kycStatus = { state: 'verified' };
    open();
    await screen.findByRole('button', { name: 'onb.saveProfile' });
    expect(api).toHaveBeenCalledWith('GET', '/onboarding/kyc/status');
  });

  it('mandate on Base, key not installed: shows the KYA key and installs exactly it, then the policy step', async () => {
    me = { userId: 'u', email: 'a@example.com', account: ACCOUNT };
    progress = { ...base, kyaAgentKey: KEY };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'onb.installKey' }));
    expect(screen.getByTestId('kya-agent-key').textContent).toBe(KEY);
    await screen.findByRole('button', { name: 'onb.policySet' });
    expect(setAgentKey).toHaveBeenCalledWith(KEY);
  });

  it('a policy on Base: done', async () => {
    me = { userId: 'u', email: 'a@example.com', account: ACCOUNT };
    progress = { ...base, kyaAgentKey: KEY, agentKey: KEY, policy: true };
    open();
    await screen.findByText('onb.done');
  });
});
