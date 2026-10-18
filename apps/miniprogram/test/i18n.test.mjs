import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REASONS, TIERS, STATUSES } from '@praetor/protocol';

const require = createRequire(import.meta.url);
const i18n = require('../miniprogram/lib/i18n.js');
const en = require('../miniprogram/lib/i18n/en.js');
const zh = require('../miniprogram/lib/i18n/zh-CN.js');

// Built from its code point: the repository refuses the character itself in any file.
const EM_DASH = String.fromCharCode(0x2014);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n: English and Simplified Chinese', () => {
  const fe = i18n.flatten(en);
  const fz = i18n.flatten(zh);

  it('has the same keys in both languages, none empty', () => {
    expect(Object.keys(fz).sort()).toEqual(Object.keys(fe).sort());
    for (const [k, v] of Object.entries({ ...fe, ...fz })) expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true);
  });

  it('keeps the same {placeholders} in both languages', () => {
    for (const k of Object.keys(fe)) expect(placeholders(fz[k]), k).toEqual(placeholders(fe[k]));
  });

  it('never binds a string with a {placeholder} straight into a page, where it cannot be filled (issue #8)', () => {
    const pages = join(import.meta.dirname, '../miniprogram/pages');
    const wxml = readdirSync(pages, { recursive: true }).filter((f) => String(f).endsWith('.wxml'));
    expect(wxml.length).toBeGreaterThan(0);
    for (const f of wxml) {
      const src = readFileSync(join(pages, String(f)), 'utf8');
      for (const m of src.matchAll(/\bt\.([\w.]+)/g)) {
        const v = fe[m[1]];
        if (typeof v === 'string') expect(placeholders(v), `${f}: t.${m[1]}`).toEqual([]);
      }
    }
  });

  it('never uses an em dash, not even the Chinese double dash', () => {
    for (const [k, v] of Object.entries({ ...fe, ...fz })) expect(v.includes(EM_DASH), k).toBe(false);
  });

  it('words every refusal reason, tier and status of spec 02', () => {
    for (const r of REASONS) expect(fe[`reason.${r}`], r).toBeTruthy();
    for (const t of TIERS) expect(fe[`tier.${t}`], t).toBeTruthy();
    for (const s of STATUSES) expect(fe[`status.${s}`], s).toBeTruthy();
  });

  it('looks up nested keys with placeholders, falls back to English, then to the key', () => {
    expect(i18n.t('en', 'approve.expires', { t: '14:59' })).toBe('Expires in 14:59');
    expect(i18n.t('zh-CN', 'approve.expires', { t: '14:59' })).toBe('14:59 后过期');
    expect(i18n.t('zh-CN', 'no.such.key')).toBe('no.such.key');
    expect(i18n.t('fr', 'home.total')).toBe('Total value');
    expect(i18n.t('en', 'reason.unknown', {})).toBe('Refused by the mandate (code {code})');
  });

  it('picks the language from WeChat\'s system language', () => {
    expect(i18n.langOf('zh_CN')).toBe('zh-CN');
    expect(i18n.langOf('zh_HK')).toBe('zh-CN');
    expect(i18n.langOf('en')).toBe('en');
    expect(i18n.langOf(undefined)).toBe('en');
    expect(i18n.table('zh-CN')).toBe(zh);
    expect(i18n.table('xx')).toBe(en);
  });
});
