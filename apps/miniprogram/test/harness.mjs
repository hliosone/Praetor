// A fake WeChat for page tests: the wx.* calls the pages make, recorded, with an api routed to a handler; App() and
// Page() capture their definitions, and a page instance gets data + setData like the real one.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MP = '../miniprogram/';

export function fakeWx(o = {}) {
  const calls = [];
  const storage = {};
  let codes = 0;
  const rec = (name, opts) => calls.push({ name, opts });
  const ok = (name, result) => (opts = {}) => { rec(name, opts); Promise.resolve().then(() => opts.success && opts.success(typeof result === 'function' ? result(opts) : result)); };
  const wx = {
    calls,
    named: (name) => calls.filter((c) => c.name === name),
    login: (opts) => { codes += 1; rec('login', opts); const code = `code-${codes}`; Promise.resolve().then(() => opts.success({ code })); },
    request: (opts) => {
      rec('request', opts);
      Promise.resolve(o.api ? o.api(opts) : { statusCode: 404, data: { error: 'no api' } }).then((r) => (r === 'fail' ? opts.fail({ errMsg: 'request:fail' }) : opts.success(r)));
    },
    scanCode: ok('scanCode', () => ({ result: o.qr ?? '' })),
    checkIsSupportSoterAuthentication: ok('checkIsSupportSoterAuthentication', () => ({ supportMode: o.supportMode ?? ['facial'] })),
    checkIsSoterEnrolledInDevice: ok('checkIsSoterEnrolledInDevice', (opts) => ({ isEnrolled: opts.checkAuthMode === 'facial', errMsg: 'ok' })),
    startSoterAuthentication: (opts) => {
      rec('startSoterAuthentication', opts);
      const r = o.soter ? o.soter(opts) : { errCode: 0, authMode: opts.requestAuthModes[0], resultJSON: JSON.stringify({ raw: opts.challenge, counter: 9, uid: 'uid-1', cpu_id: 'cpu-1' }), resultJSONSignature: 'device-sig' };
      Promise.resolve().then(() => (r.errCode === 0 ? opts.success(r) : opts.fail(r)));
    },
    setClipboardData: ok('setClipboardData', {}),
    showToast: (opts) => rec('showToast', opts),
    showModal: (opts) => { rec('showModal', opts); Promise.resolve().then(() => opts.success && opts.success({ confirm: true })); },
    navigateTo: ok('navigateTo', {}),
    reLaunch: ok('reLaunch', {}),
    navigateBack: ok('navigateBack', {}),
    setNavigationBarTitle: (opts) => rec('setNavigationBarTitle', opts),
    getStorageSync: (k) => storage[k] ?? '',
    setStorageSync: (k, v) => { storage[k] = v; },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: o.env ?? 'develop' } }),
    getAppBaseInfo: () => ({ language: o.language ?? 'en' }),
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390 }),
    createSelectorQuery: () => {
      const q = { select: () => q, fields: () => q, exec: (cb) => { rec('canvas', {}); cb([o.canvas === null ? null : { node: o.canvas ?? fakeCanvas(calls), width: 200, height: 200 }]); } };
      return q;
    },
    storage,
  };
  return wx;
}

export function fakeCanvas(calls) {
  const ctx = new Proxy({}, { get: (_t, k) => (...a) => calls.push({ name: `ctx.${String(k)}`, opts: a }), set: () => true });
  return { width: 0, height: 0, getContext: () => ctx };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };

/** Launches app.js against a fake wx; resolves once its first sign-in settled. */
export async function launch(wx) {
  globalThis.wx = wx;
  let def;
  globalThis.App = (d) => { def = d; };
  delete require.cache[require.resolve(`${MP}app.js`)];
  require(`${MP}app.js`);
  globalThis.getApp = () => def;
  def.onLaunch();
  await def.ready;
  return def;
}

const pages = new Map();
/** A fresh instance of a page (the definition is read once, like the mini program does). */
export function page(name) {
  if (!pages.has(name)) {
    let def;
    globalThis.Page = (d) => { def = d; };
    require(`${MP}pages/${name}/${name}.js`);
    pages.set(name, def);
  }
  const def = pages.get(name);
  const inst = { ...def, data: JSON.parse(JSON.stringify(def.data || {})), route: `pages/${name}/${name}` };
  inst.setData = (patch, cb) => { Object.assign(inst.data, patch); if (cb) cb(); };
  return inst;
}
