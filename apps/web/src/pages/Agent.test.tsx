// The chat scrolls inside its own box once a conversation is long (max-height 52vh): a keyboard user must be able to
// reach and scroll it (axe scrollable-region-focusable, found by the deck screenshots' three-turn chat).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/index.js';

const api = vi.fn(async () => ({ agentKey: '0x0000000000000000000000000000000000000000', validUntil: '0', riskProfile: 'BALANCED', kycLevel: 2, jurisdiction: 'HK' }));
vi.mock('../lib/api.js', async (orig) => ({ ...(await orig<typeof import('../lib/api.js')>()), api: (...a: unknown[]) => api(...(a as [])) }));

const { Agent } = await import('./Agent.js');

afterEach(() => cleanup());

describe('Agent chat', () => {
  it('is a named log that the keyboard can reach and scroll', async () => {
    render(<I18nProvider><MemoryRouter><Agent /></MemoryRouter></I18nProvider>);
    const log = await screen.findByRole('log', { name: 'Chat with your agent' });
    expect(log.tabIndex).toBe(0);
    expect(log.getAttribute('aria-live')).toBe('polite');
  });
});
