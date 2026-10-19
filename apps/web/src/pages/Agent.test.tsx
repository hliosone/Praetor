// The chat scrolls inside its own box once a conversation is long (max-height 52vh): a keyboard user must be able to
// reach and scroll it (axe scrollable-region-focusable, found by the deck screenshots' three-turn chat).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('scrolls to the newest message (on a phone the reply sat below the box)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: result\ndata: {"text":"Paid 12.50 to Café Lumen.","tools":[]}\n\n')));
    const scrolled = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    render(<I18nProvider><MemoryRouter><Agent /></MemoryRouter></I18nProvider>);
    const log = await screen.findByRole('log', { name: 'Chat with your agent' });
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 640 });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pay the café' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await screen.findByText('Paid 12.50 to Café Lumen.');
    expect(scrolled).toHaveBeenLastCalledWith(640);
    vi.unstubAllGlobals();
  });

  it('shows the agent typing while it works (a tester could not tell a slow turn from a bug)', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((ok) => { answer = ok; })));
    render(<I18nProvider><MemoryRouter><Agent /></MemoryRouter></I18nProvider>);
    await screen.findByRole('log', { name: 'Chat with your agent' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'How am I doing?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    const typing = await screen.findByTestId('agent-typing');
    expect(typing.textContent).toContain('Your agent is thinking');
    expect(typing.querySelectorAll('.dot')).toHaveLength(3);
    answer(new Response('event: result\ndata: {"text":"All within your bands.","tools":[]}\n\n'));
    await screen.findByText('All within your bands.');
    expect(screen.queryByTestId('agent-typing')).toBeNull();
    vi.unstubAllGlobals();
  });
});
