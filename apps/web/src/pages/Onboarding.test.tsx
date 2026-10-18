// Onboarding (F1) as a phone lives it: iOS Safari discards this tab while the demo KYC uses the camera in another
// one, so a reload must land where the account stands, from what the api reads in the bank and on Base (issue #1).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';
import en from '../i18n/en.json';
import zh from '../i18n/zh-CN.json';

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

describe('the five suitability questions (issue #2)', () => {
  const EN = en as Record<string, string>;
  const ZH = zh as Record<string, string>;
  const KEYS = [1, 2, 3, 4, 5].flatMap((q) => [`onb.q${q}`, `onb.q${q}.a0`, `onb.q${q}.a1`, `onb.q${q}.a2`]);

  it('asks each question in words, its answers from cautious (0) to bold (2) as the bank scores them', async () => {
    signedIn('suitability');
    show();
    await screen.findByRole('button', { name: 'Save my profile' });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(5);
    selects.forEach((s, i) => {
      const q = `onb.q${i + 1}`;
      expect(s.closest('label')!.textContent).toContain(`${i + 1}. ${EN[q]}`);
      expect([...s.options].map((o) => [o.value, o.textContent])).toEqual([0, 1, 2].map((a) => [String(a), EN[`${q}.a${a}`]]));
    });
  });

  it('every question and answer has its wording in English and in Chinese', () => {
    for (const k of KEYS) {
      expect(EN[k]?.trim(), k).toBeTruthy();
      expect(ZH[k]?.trim(), k).toBeTruthy();
      expect(ZH[k], k).not.toBe(EN[k]);
    }
  });

  it('sends the chosen answers to the bank for scoring', async () => {
    signedIn('suitability', { 'POST /onboarding/suitability': () => ({ riskProfile: 'balanced' }) });
    show();
    await screen.findByRole('button', { name: 'Save my profile' });
    fireEvent.change(screen.getAllByRole('combobox')[1]!, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save my profile' }));
    await screen.findByRole('button', { name: 'Create my agent in the TEE' });
    expect(api).toHaveBeenCalledWith('POST', '/onboarding/suitability', { answers: [1, 2, 1, 1, 1] });
  });
});
