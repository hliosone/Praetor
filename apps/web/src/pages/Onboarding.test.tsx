// Onboarding (F1) as a phone lives it: iOS Safari discards this tab while the demo KYC uses the camera in another
// one, so a reload must land where the account stands, from what the api reads in the bank and on Base (issue #1).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const KEY = '0x00000000000000000000000000000000000a9e01';

// The api by route: a value, an Error to throw, or a function of the body.
let routes: Record<string, unknown> = {};
const api = vi.fn(async (method: string, path: string, body?: unknown) => {
  const v = routes[`${method} ${path}`];
  if (v === undefined) throw new Error(`unexpected ${method} ${path}`);
  if (v instanceof Error) throw v;
  return typeof v === 'function' ? v(body) : v;
});
const setAgentKey = vi.fn(async (_key: string) => {});
vi.mock('../lib/api.js', () => ({ api: (...a: unknown[]) => api(...(a as [string, string, unknown])) }));
vi.mock('../lib/passkey.js', () => ({ assertDigest: vi.fn(), signAndSubmit: vi.fn(), signUp: vi.fn() }));
vi.mock('../lib/agent.js', () => ({ installAgent: vi.fn(), setAgentKey: (k: string) => setAgentKey(k) }));

const { Onboarding } = await import('./Onboarding.js');

const show = () => render(<I18nProvider><MemoryRouter><Onboarding /></MemoryRouter></I18nProvider>);
const signedIn = (step: string, more: Record<string, unknown> = {}) => {
  routes = { 'GET /me': { userId: 'u1', email: 'lin@example.com', account: ACCOUNT }, 'GET /onboarding/step': { step }, ...more };
};
const current = () => document.querySelector('.stepper [aria-current="step"]')?.textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  api.mockClear();
  setAgentKey.mockClear();
});

describe('Onboarding resumes where the account stands (issue #1)', () => {
  it('a visitor without a session starts with the passkey', async () => {
    routes = { 'GET /me': new Error('HTTP 401') };
    show();
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(current()).toBe('Passkey');
  });

  it('a signed-in account reloaded during onboarding goes to its first unfinished step, not back to the passkey', async () => {
    signedIn('suitability');
    show();
    await screen.findByRole('button', { name: 'Save my profile' });
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(current()).toBe('Profile');
  });

  it('resumed at the wallet step, it names the account to create', async () => {
    signedIn('account');
    show();
    await screen.findByRole('button', { name: 'Create my wallet' });
    expect(screen.getByText(ACCOUNT)).toBeTruthy();
  });

  it('notices a KYC finished in another tab, although this reloaded tab never started it', async () => {
    let reads = 0;
    signedIn('kyc', { 'GET /onboarding/kyc/status': () => (++reads === 1 ? { state: 'none' } : { state: 'verified' }) });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    show();
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(screen.getByRole('button', { name: 'Verify with the Demo KYC provider' })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => screen.getByRole('button', { name: 'Save my profile' }));
  });

  it('resumed after the mandate reached Base, it only installs the KYA agent key, then asks for the policy', async () => {
    signedIn('mandate', { 'GET /agent': { agentKey: KEY } });
    show();
    const sign = await screen.findByRole('button', { name: 'Sign with Face ID' });
    expect(screen.getByText(KEY)).toBeTruthy();
    fireEvent.click(sign);
    await screen.findByRole('button', { name: 'Set my policy' });
    expect(setAgentKey).toHaveBeenCalledWith(KEY);
  });

  it('an account already set up is told so', async () => {
    signedIn('done');
    show();
    await screen.findByText('Your agent is ready.');
  });

  it('says what went wrong when the step cannot be read, instead of offering a second sign-up', async () => {
    signedIn('kyc', { 'GET /onboarding/step': new Error('bank') });
    show();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('bank'));
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});
