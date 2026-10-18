// The mandate page of an account whose onboarding stopped before its policy (issue #1): a way back, not a dead end.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

const api = vi.fn(async (_method: string, path: string) => {
  if (path === '/policy') return { policy: null, caps: { perTx: '0', daily: '0', monthly: '0' }, spent: {} };
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
