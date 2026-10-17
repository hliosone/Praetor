import { describe, it, expect } from 'vitest';
import { slugify, anchorsOf, linksOf, checkLinks } from './links.js';

const repo = (files: Record<string, string>) => {
  const map = new Map(Object.entries(files));
  return { files: map, paths: new Set(map.keys()) };
};

describe('slugify (GitHub heading anchors)', () => {
  it('lowercases, drops punctuation and turns each space into a hyphen', () => {
    expect(slugify('Decision order for one call')).toBe('decision-order-for-one-call');
    expect(slugify('06 · Flows, end to end')).toBe('06--flows-end-to-end');
    expect(slugify('T0 to T4: the tiers (final)')).toBe('t0-to-t4-the-tiers-final');
  });

  it('reads the rendered text: code spans, emphasis and links keep only their text', () => {
    expect(slugify('`MandateHook` (ERC-7579 hook)')).toBe('mandatehook-erc-7579-hook');
    expect(slugify('**Bold** and [a link](x.md)')).toBe('bold-and-a-link');
    expect(slugify('snake_case stays')).toBe('snake_case-stays');
  });

  it('keeps Chinese characters and drops full-width punctuation', () => {
    expect(slugify('系统总览：两条链（联盟链与 Base）')).toBe('系统总览两条链联盟链与-base');
  });
});

describe('anchorsOf', () => {
  it('collects ATX and setext headings, numbering duplicates like GitHub', () => {
    const md = '# Title\n\n## Tests\n\ntext\n\n## Tests\n\nOther heading\n---\n';
    expect([...anchorsOf(md)]).toEqual(['title', 'tests', 'tests-1', 'other-heading']);
  });

  it('ignores headings inside code fences and accepts explicit HTML ids', () => {
    const md = '```bash\n# not a heading\n```\n<a id="custom-id"></a>\n## Real\n';
    const a = anchorsOf(md);
    expect(a.has('not-a-heading')).toBe(false);
    expect(a.has('custom-id')).toBe(true);
    expect(a.has('real')).toBe(true);
  });
});

describe('linksOf', () => {
  it('finds inline links, images and reference definitions with their line numbers', () => {
    const md = 'See [spec](spec/README.md) and ![shot](docs/screens/a.png).\n\n[ref]: docs/X.md#part\n';
    expect(linksOf(md)).toEqual([
      { target: 'spec/README.md', line: 1 },
      { target: 'docs/screens/a.png', line: 1 },
      { target: 'docs/X.md#part', line: 3 },
    ]);
  });

  it('skips code fences and inline code', () => {
    const md = 'Use `[x](missing.md)` here.\n```\n[y](missing.md)\n```\n';
    expect(linksOf(md)).toEqual([]);
  });

  it('accepts angle-bracket targets and titles', () => {
    expect(linksOf('[a](<docs/My File.md> "title")')).toEqual([{ target: 'docs/My File.md', line: 1 }]);
  });
});

describe('checkLinks', () => {
  it('passes valid relative links, anchors, directories and external links', () => {
    const r = repo({
      'README.md': '[arch](docs/ARCHITECTURE.md#the-picture) [spec](spec/) [web](https://example.com) [top](#praetor)\n# Praetor\n',
      'docs/ARCHITECTURE.md': '# Architecture\n## The picture\n[back](../README.md) [mail](mailto:a@b.c) [enc](../docs/My%20File.md)\n',
      'docs/My File.md': '# x\n',
      'spec/README.md': '# Spec\n',
    });
    expect(checkLinks(r.files, r.paths)).toEqual([]);
  });

  it('reports a missing file with its line', () => {
    const r = repo({ 'docs/a.md': 'line one\n[gone](missing.md)\n' });
    expect(checkLinks(r.files, r.paths)).toEqual(['docs/a.md:2: missing.md: no such file']);
  });

  it('reports a missing anchor in another file and in the same file', () => {
    const r = repo({
      'docs/a.md': '# A\n[x](b.md#nope)\n[y](#also-nope)\n',
      'docs/b.md': '# B\n',
    });
    expect(checkLinks(r.files, r.paths)).toEqual([
      'docs/a.md:2: b.md#nope: no heading or id "nope" in docs/b.md',
      'docs/a.md:3: #also-nope: no heading or id "also-nope" in docs/a.md',
    ]);
  });

  it('resolves a leading slash from the repository root and checks reference definitions', () => {
    const r = repo({
      'docs/zh-CN/a.md': '[root](/README.md)\n\n[r]: ../../spec/missing.md\n',
      'README.md': '# R\n',
    });
    expect(checkLinks(r.files, r.paths)).toEqual(['docs/zh-CN/a.md:3: ../../spec/missing.md: no such file']);
  });

  it('does not check anchors of non-Markdown targets (line anchors on source files)', () => {
    const r = repo({ 'docs/a.md': '[hook](../contracts/MandateHook.sol#L10)\n', 'contracts/MandateHook.sol': '' });
    expect(checkLinks(r.files, r.paths)).toEqual([]);
  });
});
