// Mandate without a policy (issue #1): an interrupted onboarding left the account with none; the page offers to
// finish onboarding instead of an empty form.
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.fn(async () => ({ policy: null, caps: { perTx: '0', daily: '0', monthly: '0' }, spent: {} }));
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<object>()), api: (...a: unknown[]) => api(...(a as [])) }));
vi.mock('../lib/passkey.js', () => ({ signAndSubmit: vi.fn() }));

const { Mandate } = await import('./Mandate.js');

describe('Mandate without a policy', () => {
  it('links to onboarding to set the first policy', async () => {
    render(<MemoryRouter><Mandate /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: 'onb.finish' });
    expect(link.getAttribute('href')).toBe('/start');
    expect(screen.getByText('mandate.none')).toBeTruthy();
    cleanup();
  });
});
