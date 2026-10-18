import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const api = vi.fn(async () => ({ chainId: 84532, explorer: null as string | null }));
vi.mock('../lib/api.js', () => ({ api: (...a: unknown[]) => api(...(a as [])) }));

const { TxLink, useExplorer } = await import('./TxLink.js');
const HASH = `0x${'ab'.repeat(32)}`;

afterEach(cleanup);

describe('TxLink (issue #9: no Basescan link on the local fork)', () => {
  it('links to the explorer the api names', () => {
    render(<TxLink hash={HASH} explorer="https://sepolia.basescan.org" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe(`https://sepolia.basescan.org/tx/${HASH}`);
  });

  it('on the fork (explorer null) shows the short hash labelled local fork, with no link', () => {
    const { container } = render(<TxLink hash={HASH} explorer={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe(`${HASH.slice(0, 10)} (common.localFork)`);
  });

  it('reads the explorer from /config: null on the fork renders no link', async () => {
    function Row() { const e = useExplorer(); return <TxLink hash={HASH} explorer={e} />; }
    const { container } = render(<Row />);
    await waitFor(() => expect(container.textContent).toContain('common.localFork'));
    expect(api).toHaveBeenCalledWith('GET', '/config');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
