// The pieces between the pages and the api: canvas ring geometry, the chat's server-sent events, the api client with
// its silent re-login, the session from wx.login, the WeChat adapter and the per-environment api base.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { rewriteApiBase } from '../scripts/set-api-base.mjs';

const require = createRequire(import.meta.url);
const rings = require('../miniprogram/lib/rings.js');
const chat = require('../miniprogram/lib/chat.js');
const { createApi, ApiError } = require('../miniprogram/lib/api.js');
const { createSession } = require('../miniprogram/lib/session.js');
const wxa = require('../miniprogram/lib/wx.js');
const config = require('../miniprogram/config.js');

const lin = [
  { symbol: 'USDC', weightBps: 5300, band: { minBps: 4000, targetBps: 5500, maxBps: 6000 } },
  { symbol: 'tXAU', weightBps: 3610, band: { minBps: 2000, targetBps: 3000, maxBps: 3500 } },
  { symbol: 'tXAG', weightBps: 1090, band: null },
];

describe('rings (canvas 2D)', () => {
  it('one ring per asset, outermost first, the arc proportional to the weight from 12 o\'clock', () => {
    const g = rings.geometry(lin, { size: 200, stroke: 10, gap: 6 });
    expect(g.center).toBe(100);
    expect(g.rings.map((r) => r.radius)).toEqual([95, 79, 63]);
    expect(g.rings.map((r) => r.color)).toEqual(['#8fb4ff', '#d4af37', '#c7ccd4']);
    expect(g.rings[0].start).toBeCloseTo(-Math.PI / 2);
    expect(g.rings[0].end - g.rings[0].start).toBeCloseTo(2 * Math.PI * 0.53);
  });

  it('band ticks at min, target and max; a weight outside its band is flagged', () => {
    const g = rings.geometry(lin, { size: 200, stroke: 10, gap: 6 });
    const [min, target, max] = g.rings[0].ticks;
    expect([min.kind, target.kind, max.kind]).toEqual(['min', 'target', 'max']);
    expect(min.angle).toBeCloseTo(-Math.PI / 2 + 2 * Math.PI * 0.4);
    const zero = rings.geometry([{ symbol: 'USDC', weightBps: 0, band: { minBps: 0, targetBps: 0, maxBps: 0 } }], { size: 200, stroke: 10, gap: 6 }).rings[0].ticks[0];
    expect(zero.x1).toBeCloseTo(100);
    expect(zero.y2).toBeLessThan(zero.y1);
    expect(g.rings.map((r) => r.outside)).toEqual([false, true, false]);
    expect(g.rings[2].ticks).toEqual([]);
  });

  it('clamps weights to 0..100% and draws track, arc and ticks on a 2D context', () => {
    const g = rings.geometry([{ symbol: 'USDC', weightBps: 12000, band: null }], { size: 100, stroke: 8, gap: 4 });
    expect(g.rings[0].end - g.rings[0].start).toBeCloseTo(2 * Math.PI);
    const ops = [];
    const ctx = new Proxy({}, { get: (_t, k) => (...a) => ops.push([k, ...a]), set: (_t, k, v) => { ops.push([`=${String(k)}`, v]); return true; } });
    rings.draw(ctx, rings.geometry(lin, { size: 200, stroke: 10, gap: 6 }));
    expect(ops.filter((o) => o[0] === 'arc')).toHaveLength(6);
    expect(ops.filter((o) => o[0] === 'lineTo')).toHaveLength(6);
    expect(ops.find((o) => o[0] === '=strokeStyle' && o[1] === '#d4af37')).toBeTruthy();
  });
});

describe('chat over server-sent events', () => {
  it('reads the agent turn, or its error', () => {
    expect(chat.parseSse('event: started\ndata: {}\n\nevent: result\ndata: {"text":"All good.","tools":[{"tool":"praetor_get_portfolio","status":"completed"}]}\n\n'))
      .toEqual({ text: 'All good.', tools: ['get_portfolio'] });
    expect(chat.parseSse('event: started\ndata: {}\n\nevent: error\ndata: {"error":"model down"}\n\n')).toEqual({ error: 'model down' });
    expect(chat.parseSse('event: started\ndata: {}\n\n')).toEqual({ text: '', tools: [] });
    expect(chat.parseSse('garbage')).toEqual({ text: '', tools: [] });
  });

  it('offers the quick chips of spec 07 in the user\'s language', () => {
    expect(chat.chips('en').map((c) => c.text)).toEqual(['How am I doing?', 'Who can you pay?', 'Should I rebalance?']);
    expect(chat.chips('zh-CN').map((c) => c.text)).toEqual(['我的资产怎么样？', '你能给谁付款？', '需要再平衡吗？']);
  });

  it('no chip asks to pay a payee by name: a new account has none, so it would be a dead end (#10)', () => {
    for (const lang of ['en', 'zh-CN']) for (const c of chat.chips(lang)) expect(c.text, c.key).not.toMatch(/café|咖啡/i);
  });
});

describe('api client and session', () => {
  const fakeRequest = (handler) => {
    const seen = [];
    const request = async (o) => { seen.push(o); return handler(o, seen.length); };
    return { request, seen };
  };

  it('signs in with a wx.login code, then sends the bearer token under /mp', async () => {
    let codes = 0;
    const { request, seen } = fakeRequest((o) => (o.url.endsWith('/mp/session') ? { statusCode: 200, data: { token: 'T1', account: '0xabc', expiresAt: 9 } } : { statusCode: 200, data: { ok: true } }));
    const session = createSession({ base: 'https://api.test', request, login: async () => `code-${++codes}` });
    const api = createApi({ base: 'https://api.test', request, session });
    await session.login();
    expect(session.account()).toBe('0xabc');
    expect(await api.call('GET', '/portfolio')).toEqual({ ok: true });
    // JSON stated explicitly: the api's body parser reads nothing else.
    expect(seen[0]).toMatchObject({ url: 'https://api.test/mp/session', method: 'POST', data: { code: 'code-1' }, header: { 'content-type': 'application/json' } });
    expect(seen[1]).toMatchObject({ url: 'https://api.test/mp/portfolio', method: 'GET' });
    expect(seen[1].header).toEqual({ 'content-type': 'application/json', authorization: 'Bearer T1' });
  });

  it('on a 401 signs in again once (one wx.login for concurrent calls) and retries', async () => {
    let codes = 0;
    let token = 'old';
    const { request, seen } = fakeRequest((o) => {
      if (o.url.endsWith('/mp/session')) { token = `T${codes}`; return { statusCode: 200, data: { token, account: '0xabc', expiresAt: 9 } }; }
      return o.header.authorization === `Bearer ${token}` && token !== 'old' ? { statusCode: 200, data: 'ok' } : { statusCode: 401, data: { error: 'not signed in' } };
    });
    const session = createSession({ base: 'https://api.test', request, login: async () => { codes++; return `c${codes}`; } });
    const api = createApi({ base: 'https://api.test', request, session });
    expect(await Promise.all([api.call('GET', '/status'), api.call('GET', '/agent')])).toEqual(['ok', 'ok']);
    expect(codes).toBe(1);
    expect(seen.filter((o) => o.url.endsWith('/mp/session'))).toHaveLength(1);
  });

  it('turns other statuses into an ApiError with the api\'s message', async () => {
    const { request } = fakeRequest(() => ({ statusCode: 403, data: { error: 'WeChat is not linked to an account' } }));
    const api = createApi({ base: 'https://api.test', request, session: { token: () => 'T', login: async () => {} } });
    const e = await api.call('GET', '/portfolio').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, message: 'WeChat is not linked to an account' });
  });

  it('the chat comes back as text (server-sent events), with a long timeout for the model', async () => {
    const { request, seen } = fakeRequest(() => ({ statusCode: 200, data: 'event: result\ndata: {"text":"hi","tools":[]}\n\n' }));
    const api = createApi({ base: 'https://api.test', request, session: { token: () => 'T', login: async () => {} } });
    expect(await api.chat('hello')).toEqual({ text: 'hi', tools: [] });
    expect(seen[0]).toMatchObject({ url: 'https://api.test/mp/agent/chat', method: 'POST', data: { message: 'hello' }, dataType: 'text', timeout: 120000 });
  });
});

describe('WeChat adapter (lib/wx.js)', () => {
  afterEach(() => { delete globalThis.wx; });

  it('wraps the callback APIs in promises over the global wx of the moment', async () => {
    globalThis.wx = {
      login: (o) => o.success({ code: 'abc' }),
      scanCode: (o) => o.success({ result: 'https://x/mp/link?id=1', scanType: o.scanType }),
      checkIsSupportSoterAuthentication: (o) => o.success({ supportMode: ['facial'] }),
      startSoterAuthentication: (o) => o.fail({ errCode: 90008, errMsg: 'user cancel' }),
      request: (o) => o.fail({ errMsg: 'request:fail timeout' }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
      getAppBaseInfo: () => ({ language: 'zh_CN' }),
    };
    expect(await wxa.login()).toBe('abc');
    expect(await wxa.scanCode()).toBe('https://x/mp/link?id=1');
    expect(await wxa.soterSupport()).toEqual(['facial']);
    expect(await wxa.startSoter({ requestAuthModes: ['facial'] })).toEqual({ errCode: 90008, errMsg: 'user cancel' });
    await expect(wxa.request({ url: 'u' })).rejects.toMatchObject({ errMsg: 'request:fail timeout' });
    expect(wxa.envVersion()).toBe('trial');
    expect(wxa.systemLanguage()).toBe('zh_CN');
  });
});

describe('api base per environment (config.js)', () => {
  it('develop, trial and release each have an https origin, with no secret in the mini program', () => {
    expect(Object.keys(config.API_BASE).sort()).toEqual(['develop', 'release', 'trial']);
    for (const env of ['develop', 'trial', 'release']) expect(config.apiBase(env)).toMatch(/^https:\/\/[^/]+$/);
    expect(config.apiBase('unknown')).toBe(config.API_BASE.develop);
    expect(config.webUrl('trial', '/settings')).toBe(`${config.API_BASE.trial}/settings`);
  });

  it('`pnpm --filter @praetor/miniprogram tunnel` rewrites one environment from the tunnel URL, https origins only', () => {
    const src = readFileSync(new URL('../miniprogram/config.js', import.meta.url), 'utf8');
    const out = rewriteApiBase(src, 'develop', 'https://quiet-river-1234.trycloudflare.com');
    const m = { exports: {} };
    new Function('module', 'exports', 'wx', out)(m, m.exports, undefined);
    expect(m.exports.API_BASE.develop).toBe('https://quiet-river-1234.trycloudflare.com');
    expect(m.exports.API_BASE.release).toBe(config.API_BASE.release);
    expect(() => rewriteApiBase(src, 'develop', 'http://insecure.example')).toThrow(/https/);
    expect(() => rewriteApiBase(src, 'develop', 'https://x.example/path')).toThrow(/origin/);
    expect(() => rewriteApiBase(src, 'staging', 'https://x.example')).toThrow(/environment/);
  });
});
