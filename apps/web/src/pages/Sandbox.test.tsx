// The judges' sandbox mints demo USDC, which only the local fork allows: on the live server the page says so and
// sends the visitor to the real onboarding instead of failing at its funding step.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

let sandbox = false;
const api = vi.fn(async (_method: string, path: string) => {
  if (path === '/config') return { chainId: 84532, domainName: 'Praetor', mandateHook: '0x1', usdc: '0x2', txau: '0x3', txag: '0x4', deskSpreadBps: 30, sandbox };
  throw new Error(`unexpected ${path}`);
});
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<typeof import('../lib/api.js')>()), api: (...a: unknown[]) => api(...(a as [string, string])) }));

const { Sandbox } = await import('./Sandbox.js');
afterEach(() => cleanup());

describe('Sandbox on the live server', () => {
  it('says the one-click demo is fork-only and links to the real onboarding', async () => {
    sandbox = false;
    render(<I18nProvider><MemoryRouter><Sandbox /></MemoryRouter></I18nProvider>);
    const link = await screen.findByRole('link', { name: 'Create your account' });
    expect(link.getAttribute('href')).toBe('/start');
    expect(screen.queryByRole('button', { name: 'Create a demo account' })).toBeNull();
  });
});
