// No page scrolls sideways on a phone (#3). jsdom does no layout, so this checks the rules that keep long values inside
// the viewport; the Playwright journey measures the real page width at 390 px (e2e/lib.ts shoot()).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(src, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1]!.split(',').map((s) => s.trim()), body: m[2]! }));
/** The value of a property in the top-level rules that name this selector (the last one wins, as in the cascade). */
const decl = (selector: string, prop: string) => {
  let v: string | undefined;
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(r.body);
    if (m) v = m[1]!.trim();
  }
  return v;
};

describe('phone width (#3)', () => {
  it('long hex values wrap anywhere: agent DID, digest, payee, calldata, hashes in the chat', () => {
    for (const s of ['.mono', 'code', 'pre', 'dd', '.bubble', '.notice']) expect(decl(s, 'overflow-wrap'), s).toBe('anywhere');
    expect(decl('body', 'overflow-wrap'), 'body').toBe('break-word');
  });

  it('the landing hero shrinks after a resize: a 3D canvas keeps its pixel width, and a 1fr column will not go below it', () => {
    // Found by the 390 px check after the 1440 px screenshot (a phone turned from landscape to portrait does the same).
    expect(decl('.hero', 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(decl('.stage', 'min-width')).toBe('0');
    expect(decl('.stage', 'overflow')).toBe('hidden');
  });

  it('grid columns never ask for more than the width they have, and grid or row children may shrink', () => {
    expect(decl('.grid.two', 'grid-template-columns')).toBe('repeat(auto-fit, minmax(min(320px, 100%), 1fr))');
    expect(decl('.grid.three', 'grid-template-columns')).toBe('repeat(auto-fit, minmax(min(240px, 100%), 1fr))');
    for (const s of ['.grid > *', '.row > *']) expect(decl(s, 'min-width'), s).toBe('0');
    expect(decl('dd', 'margin')).toBe('0');
  });

  it('tables scroll inside their own box, with hashes kept on one line', () => {
    expect(decl('.table-wrap', 'overflow-x')).toBe('auto');
    expect(decl('.table-wrap', 'max-width')).toBe('100%');
    expect(decl('td .mono', 'white-space')).toBe('nowrap');
    expect(decl('td.mono', 'white-space')).toBe('nowrap');
    const pages = join(src, 'pages');
    for (const f of readdirSync(pages).filter((n) => n.endsWith('.tsx'))) {
      const tsx = readFileSync(join(pages, f), 'utf8');
      const tables = tsx.match(/<table[\s>]/g)?.length ?? 0;
      expect(tsx.match(/<div className="table-wrap">\s*<table[\s>]/g)?.length ?? 0, f).toBe(tables);
    }
  });

  it('never hides the overflow of the page itself (that would only mask a wide element)', () => {
    for (const s of ['html', 'body']) {
      expect(decl(s, 'overflow-x'), s).toBeUndefined();
      expect(decl(s, 'overflow'), s).toBeUndefined();
    }
  });
});
