// The dashboard of an account whose onboarding stopped before its policy (issue #1): a way back, not a dead end.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

const POLICY = { autoCap: '1', hardCap: '1', dailyBudget: '1', monthlyBudget: '1', dailyCount: 1, bufferUsdc: '1', payees: [], merchants: [], bands: [], maxRebalancesPerDay: 1, maxTradeUsd: '1', maxSlippageBps: 1, validUntil: '1', soterEnabled: false };
let policy: unknown = null;
let effective = 'ACTIVE';
let explorer: string | null = 'https://sepolia.basescan.org';
let demoMarket = false;
const shocks: unknown[] = [];
const api = vi.fn(async (_method: string, path: string, body?: unknown) => {
  const p = path.split('?')[0];
  if (p === '/demo/shock') { shocks.push(body); return { asset: 'XAU', price8: '318000000000', txHash: '0xabc' }; }
  if (p === '/policy') return { policy, caps: { perTx: '0', daily: '0', monthly: '0' }, spent: {} };
  if (p === '/portfolio') return { totalUsd6: '0', assets: [] };
  if (p === '/status') return { effective, heartbeatValidUntil: '0', now: '0' };
  if (p === '/agent') return { agentKey: '0x0000000000000000000000000000000000000000', validUntil: '0', riskProfile: 'NONE', kycLevel: 0, jurisdiction: '' };
  if (p === '/activity') return { items: [] };
  if (p === '/approvals') return { approvals: [] };
  if (p === '/me') return { userId: 'u', email: 'lin@example.com', account: '0x00000000000000000000000000000000000c0ffe' };
  if (p === '/config') return { chainId: 84532, domainName: 'Praetor', mandateHook: '0x1', usdc: '0x2', txau: '0x3', txag: '0x4', deskSpreadBps: 0, explorer, demoMarket };
  throw new Error(`unexpected ${path}`);
});
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<typeof import('../lib/api.js')>()), api: (...a: unknown[]) => api(...(a as [string, string, unknown])) }));
vi.mock('../lib/passkey.js', () => ({ signAndSubmit: vi.fn() }));

const { Home } = await import('./Home.js');
const show = () => render(<I18nProvider><MemoryRouter><Home /></MemoryRouter></I18nProvider>);

afterEach(() => cleanup());

describe('Home without a policy (issue #1)', () => {
  it('links back to the onboarding to finish setting up', async () => {
    policy = null;
    show();
    const link = await screen.findByRole('link', { name: 'Finish setting up' });
    expect(link.getAttribute('href')).toBe('/start');
  });

  it('says nothing of the kind once the policy is set', async () => {
    policy = POLICY;
    show();
    await screen.findByTestId('status');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: 'Finish setting up' })).toBeNull();
  });
});

describe('Home of a frozen account', () => {
  it('says so above everything: nothing moves until two of the three members lift it', async () => {
    policy = POLICY;
    effective = 'FROZEN';
    show();
    const banner = await screen.findByTestId('frozen-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toMatch(/frozen by the consortium/i);
    expect(banner.textContent).toMatch(/two of its three members/);
  });

  it('shows no banner while the account is active', async () => {
    policy = POLICY;
    effective = 'ACTIVE';
    show();
    await screen.findByTestId('status');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('frozen-banner')).toBeNull();
  });
});

describe('Home status', () => {
  it('shows the account status alone, without the consortium heartbeat timer (noise for the owner)', async () => {
    policy = POLICY;
    effective = 'ACTIVE';
    show();
    expect((await screen.findByTestId('status')).textContent).toBe('Active');
    expect(document.body.textContent).not.toMatch(/heartbeat|stale/i);
  });
});

describe('Home wallet', () => {
  it('shows the wallet address, linked to the explorer on Base Sepolia (a tester could not find it anywhere)', async () => {
    policy = POLICY;
    explorer = 'https://sepolia.basescan.org';
    show();
    const link = await screen.findByRole('link', { name: '0x00000000000000000000000000000000000c0ffe' });
    expect(link.getAttribute('href')).toBe('https://sepolia.basescan.org/address/0x00000000000000000000000000000000000c0ffe');
  });

  it('shows it as text on the local fork, which no public explorer knows', async () => {
    explorer = null;
    show();
    expect((await screen.findByTestId('wallet')).textContent).toBe('0x00000000000000000000000000000000000c0ffe');
    expect(screen.queryByRole('link', { name: '0x00000000000000000000000000000000000c0ffe' })).toBeNull();
  });
});

describe('Home demo market', () => {
  it('on the local fork, moves gold by a demo price from a button and says the new price', async () => {
    policy = POLICY;
    demoMarket = true;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Gold +20%' }));
    expect(await screen.findByText('Gold now 3,180.00 USD (demo price)')).toBeTruthy();
    expect(shocks.at(-1)).toEqual({ asset: 'XAU', pct: 20 });
    expect(screen.getByRole('button', { name: 'Gold -20%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Silver +20%' })).toBeTruthy();
  });

  it('has no demo prices on the live server, where the oracle takes Pyth prices', async () => {
    demoMarket = false;
    show();
    await screen.findByTestId('status');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Gold +20%' })).toBeNull();
  });
});
