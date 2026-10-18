// The stand-in for a WeChat DevTools build (no DevTools on this machine, MANUAL section 5): the project settings, every
// page's four files, balanced WXML, handlers and strings that exist, scripts the phone can run, no secret, and the
// design tokens of the web app with readable contrast.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { page } from './harness.mjs';

const require = createRequire(import.meta.url);
const ROOT = new URL('../', import.meta.url);
const MP = new URL('../miniprogram/', import.meta.url);
const read = (rel, base = MP) => readFileSync(new URL(rel, base), 'utf8');
const app = JSON.parse(read('app.json'));
const i18n = require('../miniprogram/lib/i18n.js');
const flatEn = i18n.flatten(require('../miniprogram/lib/i18n/en.js'));
const flatZh = i18n.flatten(require('../miniprogram/lib/i18n/zh-CN.js'));

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = new URL(f, dir);
    if (statSync(p).isDirectory()) files(new URL(`${f}/`, dir), out);
    else out.push(p);
  }
  return out;
}
const all = files(MP);
const rel = (u) => u.href.slice(MP.href.length);

describe('project.config.json', () => {
  const cfg = JSON.parse(read('project.config.json', ROOT));

  it('uploads only miniprogram/ (no package.json, tests or sources)', () => {
    expect(cfg.miniprogramRoot).toBe('miniprogram/');
    expect(cfg.compileType).toBe('miniprogram');
    for (const u of all) expect(rel(u)).not.toMatch(/(^|\/)(package\.json|node_modules|.*\.test\.m?js|.*\.mjs)$/);
  });

  it('never transpiles: ES6 to ES5 and enhance off, lib/protocol.js excluded from Babel', () => {
    expect(cfg.setting.es6).toBe(false);
    expect(cfg.setting.enhance).toBe(false);
    expect(cfg.setting.babelSetting.ignore).toContain('lib/protocol.js');
  });

  it('a placeholder AppID (the human sets the test account\'s in DevTools) and base library 3.x', () => {
    expect(cfg.appid).toBe('touristappid');
    expect(Number(cfg.libVersion.split('.')[0])).toBeGreaterThanOrEqual(3);
  });
});

describe('pages', () => {
  it('every page of app.json has its .js, .wxml, .wxss and .json', () => {
    for (const p of app.pages) for (const ext of ['js', 'wxml', 'wxss', 'json']) expect(existsSync(new URL(`${p}.${ext}`, MP)), `${p}.${ext}`).toBe(true);
    expect(existsSync(new URL(app.sitemapLocation, MP))).toBe(true);
  });

  for (const p of app.pages) {
    const name = p.split('/')[1];
    const wxml = read(`${p}.wxml`);

    it(`${name}: balanced WXML tags`, () => {
      const stack = [];
      for (const m of wxml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
        const [, close, tag, , self] = m;
        if (self) continue;
        if (close) expect(stack.pop(), `</${tag}> in ${p}.wxml`).toBe(tag);
        else stack.push(tag);
      }
      expect(stack).toEqual([]);
    });

    it(`${name}: every bind/catch handler exists on the page`, () => {
      const def = page(name);
      for (const m of wxml.matchAll(/\b(?:bind|catch)(?::)?[a-z]+="([^"]+)"/g)) expect(typeof def[m[1]], `${m[1]} in ${p}.wxml`).toBe('function');
    });

    it(`${name}: every {{t.*}} string exists in English and Chinese`, () => {
      for (const expr of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
        for (const k of expr[1].matchAll(/\bt\.([A-Za-z0-9_.]+)/g)) {
          expect(flatEn[k[1]], `t.${k[1]} in ${p}.wxml`).toBeTypeOf('string');
          expect(flatZh[k[1]], `t.${k[1]} in ${p}.wxml (zh-CN)`).toBeTypeOf('string');
        }
      }
    });

    it(`${name}: no {{t.*}} string with a {placeholder} (WXML cannot fill it: the page builds it with t())`, () => {
      for (const expr of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
        for (const k of expr[1].matchAll(/\bt\.([A-Za-z0-9_.]+)/g)) expect(flatEn[k[1]], `t.${k[1]} in ${p}.wxml`).not.toMatch(/\{\w+\}/);
      }
    });
  }
});

describe('scripts the phone can run', () => {
  const js = all.filter((u) => u.href.endsWith('.js'));

  it('no BigInt literal anywhere (esbuild flags each one below es2020)', async () => {
    for (const u of js) {
      const r = await transform(readFileSync(u, 'utf8'), { target: 'es2019', loader: 'js' });
      expect(r.warnings.filter((w) => /Big integer literal/.test(w.text)), rel(u)).toEqual([]);
    }
  });

  it('every require is a relative path to a file of the mini program (it has no node_modules)', () => {
    for (const u of js) {
      for (const m of readFileSync(u, 'utf8').matchAll(/\brequire\(\s*'([^']+)'\s*\)/g)) {
        expect(m[1], `${rel(u)} requires ${m[1]}`).toMatch(/^\.\.?\//);
        expect(existsSync(new URL(m[1], u)), `${rel(u)} requires ${m[1]}`).toBe(true);
      }
    }
  });

  it('carries no secret: no private key, no app secret, no PEM', () => {
    for (const u of all) {
      const s = readFileSync(u, 'utf8');
      expect(s, rel(u)).not.toMatch(/0x[0-9a-fA-F]{64}\b|-----BEGIN|MP_SECRET|AppSecret|app_secret/);
    }
  });
});

describe('design tokens (spec 07) and contrast', () => {
  const vars = (css, selector) => {
    const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(css)[1];
    return Object.fromEntries([...block.matchAll(/--([a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].replace(/\s+/g, '').toLowerCase()]));
  };
  const mp = vars(read('app.wxss'), 'page');
  const web = vars(readFileSync(new URL('../../web/src/styles.css', import.meta.url), 'utf8'), ':root');

  it('uses the web app\'s colours, same names, same values', () => {
    const names = ['paper', 'sheet', 'ink', 'graphite', 'hairline', 'glass', 'well', 'signed', 'asked', 'refused', 'usdc', 'gold', 'silver'];
    for (const n of names) expect(mp[n], n).toBe(web[n]);
  });

  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it('every text colour on its background reaches 4.5:1', () => {
    const pairs = [
      ['ink', 'paper'], ['ink', 'sheet'], ['graphite', 'paper'], ['graphite', 'sheet'], ['signed', 'sheet'], ['asked', 'sheet'], ['refused', 'sheet'],
      ['paper', 'ink'], ['paper', 'refused'],
    ];
    for (const [fg, bg] of pairs) expect(contrast(mp[fg], mp[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffd4d4', mp.sheet), 'danger button text').toBeGreaterThanOrEqual(4.5);
  });
});
