// The built-in case set itself: the spec 08 minimum (at least 40 cases, items 1 to 11, ten prompt injections in both
// drivers), names a running suite can resolve, and Foundry references that exist.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN, GLOBAL } from '../cases/index.js';
import { CATEGORIES, type Case, type Input } from '../lib/case.js';
import { CUSTOM_EXECUTORS, FIXTURES, VARS } from '../lib/names.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const all = [...BUILTIN, ...GLOBAL];
const inputs = (c: Case): Input[] => [...c.setup, c.input];
const placeholders = (v: unknown): string[] => (JSON.stringify(v).match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? []).map((p) => p.slice(1));

describe('built-in red-team cases', () => {
  it('at least 40 cases with unique ids', () => {
    expect(BUILTIN.length).toBeGreaterThanOrEqual(40);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('cover every item of the spec 08 minimum set, with the category of that item', () => {
    for (let item = 1; item <= 11; item++) expect(BUILTIN.filter((c) => c.item === item).length, `item ${item}`).toBeGreaterThan(0);
    for (const c of all) expect(c.category, c.id).toBe(CATEGORIES[c.item - 1]);
  });

  it('ten prompt injections, sent to both the scripted and the real model', () => {
    const pi = BUILTIN.filter((c) => c.item === 1);
    expect(pi.length).toBeGreaterThanOrEqual(10);
    for (const c of pi) expect(c.drivers, c.id).toEqual(['scripted', 'live']);
  });

  it('every scripted chat has a script for the fake model', () => {
    for (const c of all) for (const i of inputs(c)) if (i.kind === 'chat') expect(i.script?.length, c.id).toBeGreaterThan(0);
  });

  it('only known fixtures, custom executors and placeholders', () => {
    for (const c of all) {
      expect(FIXTURES, c.id).toContain(c.fixture);
      for (const i of inputs(c)) if (i.kind === 'custom') expect(CUSTOM_EXECUTORS, c.id).toContain(i.name);
      for (const p of placeholders([c.setup, c.input])) expect(VARS, `${c.id} uses $${p}`).toContain(p);
    }
  });

  it('every Foundry reference names a test that exists in that file', () => {
    for (const c of all) {
      for (const ref of c.foundry) {
        const [file, test] = ref.split('::');
        expect(readFileSync(`${root}${file}`, 'utf8'), `${c.id}: ${ref}`).toContain(`function ${test}(`);
      }
    }
  });
});
