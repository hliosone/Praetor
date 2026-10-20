// Signing in with an account whose onboarding stopped half way (a discarded tab, issue #1) resumes it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

let step: unknown = 'kyc';
let sandbox = true;
const api = vi.fn(async (_method: string, path: string) => {
  if (path === '/onboarding/step') { if (step instanceof Error) throw step; return { step }; }
  if (path === '/config') return { sandbox };
  throw new Error(`unexpected ${path}`);
});
vi.mock('../lib/api.js', () => ({ api: (...a: unknown[]) => api(...(a as [string, string])) }));
vi.mock('../lib/passkey.js', () => ({ signIn: vi.fn(async () => ({ account: '0x00000000000000000000000000000000000c0ffe' })) }));
// The phone animation draws on a canvas jsdom does not have.
vi.mock('../components/PhoneView.js', () => ({ PhoneView: () => null }));

const { Landing } = await import('./Landing.js');

const signIn = () => {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/start" element={<p>onboarding page</p>} />
          <Route path="/home" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

afterEach(() => cleanup());

describe('Landing sign-in (issue #1)', () => {
  it('takes an account that is not set up yet back to the onboarding', async () => {
    step = 'kyc';
    signIn();
    await screen.findByText('onboarding page');
  });

  it('takes a set-up account to its dashboard', async () => {
    step = 'done';
    signIn();
    await screen.findByText('home page');
  });

  it('goes to the dashboard when the step cannot be read (the dashboard links back)', async () => {
    step = new Error('bank');
    signIn();
    await screen.findByText('home page');
  });
});

describe('Landing sandbox button', () => {
  const show = () => render(<I18nProvider><MemoryRouter><Landing /></MemoryRouter></I18nProvider>);

  it('offers the one-click sandbox where it can mint demo USDC (the local fork)', async () => {
    sandbox = true;
    show();
    expect(await screen.findByRole('link', { name: 'Open sandbox' })).toBeTruthy();
  });

  it('hides it on the live server, where its faucet cannot exist', async () => {
    sandbox = false;
    show();
    await screen.findByRole('link', { name: 'Start' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: 'Open sandbox' })).toBeNull();
  });
});
