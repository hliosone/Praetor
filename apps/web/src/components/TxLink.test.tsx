import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/index.js';
import { TxLink } from './TxLink.js';

const HASH = `0x${'ab'.repeat(32)}`;
const show = (explorer: string | null | undefined) => render(<I18nProvider><TxLink hash={HASH} explorer={explorer} /></I18nProvider>);
afterEach(cleanup);

describe('TxLink: a Base transaction (#9)', () => {
  it('live: the short hash links to the explorer the api names', () => {
    show('https://sepolia.basescan.org');
    const a = screen.getByRole('link');
    expect(a.getAttribute('href')).toBe(`https://sepolia.basescan.org/tx/${HASH}`);
    expect(a.textContent).toBe(HASH.slice(0, 10));
  });

  it('local fork: the short hash marked "local fork", and no link (BaseScan never saw it)', () => {
    const { container } = show(null);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe(`${HASH.slice(0, 10)} (local fork)`);
  });

  it('no link either while /config has not answered', () => {
    const { container } = show(undefined);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe(HASH.slice(0, 10));
  });

  it('no page or component hard-codes BaseScan: links come from /config', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const dir of ['pages', 'components']) {
      for (const f of readdirSync(join(src, dir)).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))) {
        expect(readFileSync(join(src, dir, f), 'utf8'), `${dir}/${f}`).not.toMatch(/basescan/i);
      }
    }
  });
});
