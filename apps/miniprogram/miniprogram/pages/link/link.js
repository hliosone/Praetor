// Link WeChat (spec 06 F2 steps 2-3): scan the web app's QR code, recompute the LINK_WECHAT digest, run SOTER over it
// and post the result with a fresh wx.login code under this mini program's session (the api checks that the proof binds
// this WeChat user). The owner then confirms with the passkey on the web; once Base has the binding, signing in again
// gives this WeChat user the account.
const i18n = require('../../lib/i18n.js');
const verify = require('../../lib/verify.js');
const soter = require('../../lib/soter.js');
const wxa = require('../../lib/wx.js');

const POLL_MS = 3000;
const POLL_FOR_MS = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Page({
  data: { t: {}, stage: 'scan', account: '', refuse: '', error: '', busy: false, mode: null },

  async onLoad(query) {
    const app = getApp();
    await app.ready;
    this.setData({ t: i18n.table(app.lang) });
    wx.setNavigationBarTitle({ title: i18n.t(app.lang, 'link.title') });
    if (query && query.id) await this.load(query.id);
  },
  onUnload() { this.gone = true; },

  refuseWith(key) {
    const lang = getApp().lang;
    this.setData({ stage: 'scan', refuse: i18n.t(lang, 'approve.refuse', { why: i18n.t(lang, `link.problem.${key}`) }) });
  },

  async scan() {
    try {
      const id = verify.linkIdFromQr(await wxa.scanCode());
      if (!id) return this.refuseWith('qr');
      await this.load(id);
    } catch (e) {
      this.setData({ error: i18n.t(getApp().lang, 'common.error', { e: e.errMsg || e.message }) });
    }
  },

  async load(id) {
    const app = getApp();
    this.id = id;
    this.check = null;
    this.setData({ refuse: '', error: '' });
    try {
      const [config, view, supportMode] = await Promise.all([app.api.call('GET', '/config'), app.api.call('GET', `/link/${id}`), wxa.soterSupport().catch(() => [])]);
      const check = verify.checkLink(view, { config, nowS: Math.floor(Date.now() / 1000), lang: app.lang });
      if (!check.ok) return this.refuseWith(check.problems[0] || check.closed);
      this.check = check;
      this.setData({ stage: 'confirm', account: check.account, mode: soter.pickMode(supportMode) });
    } catch (e) {
      this.setData({ error: i18n.t(app.lang, 'common.error', { e: e.message }) });
    }
  },

  async confirm() {
    if (!this.check || !this.data.mode || this.data.busy) return;
    const app = getApp();
    this.setData({ busy: true, error: '' });
    try {
      const res = await wxa.startSoter(soter.startOptions(this.data.mode, this.check.challenge, this.check.authContent));
      const body = soter.checkResult(res, this.check.challenge);
      body.code = await wxa.login();
      await app.api.call('POST', `/link/${this.id}/soter`, body);
      this.setData({ busy: false, stage: 'waiting' });
      await this.waitForPasskey();
    } catch (e) {
      this.setData({ busy: false, error: i18n.t(app.lang, 'common.error', { e: e.message }) });
    }
  },

  /** The owner confirms on the web with the passkey; then Base holds the binding and a new sign-in has the account. */
  async waitForPasskey() {
    const app = getApp();
    const until = Date.now() + POLL_FOR_MS;
    const every = this.pollMs === undefined ? POLL_MS : this.pollMs;
    while (!this.gone && Date.now() < until) {
      await sleep(every);
      const v = await app.api.call('GET', `/link/${this.id}`).catch(() => null);
      if (v && v.state === 'linked') {
        await app.signIn();
        this.setData({ stage: 'linked' });
        return;
      }
    }
  },

  goHome() { wx.reLaunch({ url: '/pages/home/home' }); },
});
