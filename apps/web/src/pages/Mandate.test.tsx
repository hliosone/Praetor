// The mandate page of an account whose onboarding stopped before its policy (issue #1): a way back, not a dead end.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

let current: Record<string, unknown> = { policy: null, caps: { perTx: '0', daily: '0', monthly: '0' }, spent: {} };
const api = vi.fn(async (_method: string, path: string) => {
  if (path === '/policy') return current;
  throw new Error(`unexpected ${path}`);
});
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<typeof import('../lib/api.js')>()), api: (...a: unknown[]) => api(...(a as [string, string])) }));
vi.mock('../lib/passkey.js', () => ({ signAndSubmit: vi.fn() }));

const { Mandate } = await import('./Mandate.js');

afterEach(() => cleanup());

describe('Mandate without a policy (issue #1)', () => {
  it('links back to the onboarding to finish setting up', async () => {
    render(<I18nProvider><MemoryRouter><Mandate /></MemoryRouter></I18nProvider>);
    const link = await screen.findByRole('link', { name: 'Finish setting up' });
    expect(link.getAttribute('href')).toBe('/start');
    expect(screen.getByText('No policy yet.')).toBeTruthy();
  });
});

describe('Mandate in plain words when approved payments passed the daily budget', () => {
  it('says the budget is what the agent spends without asking, quotes the hook\'s spending, and names the bank\'s daily limit as the ceiling', async () => {
    const policy = {
      autoCap: '200000000', hardCap: '2000000000', dailyBudget: '500000000', monthlyBudget: '3000000000', dailyCount: 10, bufferUsdc: '1000000000', payees: [], merchants: [],
      bands: [], maxRebalancesPerDay: 1, maxTradeUsd: '1000000000', maxSlippageBps: 100, validUntil: '4000000000', soterEnabled: false,
    };
    current = { policy, caps: { perTx: '1000000000', daily: '2000000000', monthly: '10000000000' }, spent: { day: '1060000000', month: '1060000000', count: '4', rebalances: '0' } };
    render(<I18nProvider><MemoryRouter><Mandate /></MemoryRouter></I18nProvider>);
    await screen.findByText(/Your agent pays up to/);
    // "At most 500 a day" read as a ceiling the owner's approvals had already passed (spent 1,060).
    expect(document.body.textContent).not.toMatch(/At most/);
    expect(screen.getByTestId('mandate-budget').textContent).toBe('Without asking you, it spends at most 500.00 a day and 3,000.00 a month, 10 payments a day; beyond that it asks you.');
    expect(screen.getByTestId('mandate-spent').textContent).toBe('Spent today (UTC day on Base): 1,060.00 in 4 payments; this 30-day period: 1,060.00. Payments you approve count too and can go past your budget, never past the bank\'s limit of 2,000.00 a day and 10,000.00 a month.');
  });

  it('names the unit of each amount in the form once (the deck shot read "Keep at least (USDC) (USDC)")', async () => {
    render(<I18nProvider><MemoryRouter><Mandate /></MemoryRouter></I18nProvider>);
    expect(await screen.findByLabelText('Keep at least (USDC)')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\(USDC\)\s*\(USDC\)/);
  });
});
