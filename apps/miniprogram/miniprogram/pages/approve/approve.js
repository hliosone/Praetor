// Approve (spec 06 F6 step 5a): ?id= -> the decoded call, why it needs the owner, the countdown in Base time. The
// digest is recomputed here from what is shown (lib/verify.js); SOTER signs that digest, then a fresh wx.login code goes
// with the result to the api, which has the attester TEE check it and registers the approval on Base. Flow from Alex's
// spike (services/approvals/soter/miniprogram/pages/approve/approve.js), see PREEXISTING.md.
const i18n = require('../../lib/i18n.js');
const models = require('../../lib/models.js');
const verify = require('../../lib/verify.js');
const calls = require('../../lib/calls.js');
const soter = require('../../lib/soter.js');
const countdown = require('../../lib/countdown.js');
const wxa = require('../../lib/wx.js');

Page({
  data: {
    t: {}, loading: true, error: '', ok: false, refuse: '', what: '', others: [], why: '', left: '', leftText: '', mode: null, noSoter: false,
    digest: '', details: {}, showDetails: false, result: '', resultText: '', busy: false,
  },

  async onLoad(query) {
    this.id = query.id;
    const app = getApp();
    await app.ready;
    const lang = app.lang;
    this.setData({ t: i18n.table(lang) });
    wx.setNavigationBarTitle({ title: i18n.t(lang, 'approve.title') });
    try {
      const [config, view, status, supportMode] = await Promise.all([
        app.api.call('GET', '/config'), app.api.call('GET', `/approvals/${encodeURIComponent(this.id)}`), app.api.call('GET', '/status'),
        wxa.soterSupport().catch(() => []),
      ]);
      const phoneNow = Date.now();
      this.offset = countdown.clockOffset(status.now, phoneNow);
      this.expiresAt = view.tier2.expiresAt;
      const check = verify.checkApproval(view, { config, account: app.session.account(), nowS: Number(status.now), lang });
      this.check = check;
      const mode = soter.pickMode(supportMode);
      const closed = check.closed === 'state' ? view.state : check.closed;
      this.setData({
        loading: false, ok: check.ok, mode, noSoter: check.ok && !mode,
        refuse: check.problems.length ? i18n.t(lang, 'approve.refuse', { why: i18n.t(lang, `approve.problem.${check.problems[0]}`) }) : '',
        what: check.callIndex >= 0 ? calls.describe(lang, check.decoded[check.callIndex]) : '',
        others: check.decoded.filter((_d, i) => i !== check.callIndex).map((d) => calls.describe(lang, d)),
        why: models.reasonText(lang, view.reason), digest: check.digest || '',
        details: { account: view.tier2.account, callHash: view.tier2.callHash, nonce: view.tier2.nonce, expiresAt: view.tier2.expiresAt },
        result: closed || '', resultText: closed && check.problems.length === 0 ? models.resultText(lang, closed) : '',
        ...this.leftData(lang, countdown.secondsLeft(view.tier2.expiresAt, this.offset, phoneNow)),
      });
      if (check.ok) this.timer = setInterval(() => this.tick(), 1000);
    } catch (e) {
      this.setData({ loading: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },
  onUnload() { clearInterval(this.timer); },

  tick() {
    const s = countdown.secondsLeft(this.expiresAt, this.offset, Date.now());
    this.setData(this.leftData(getApp().lang, s));
    if (s === 0) {
      clearInterval(this.timer);
      this.setData({ ok: false, result: 'expired', resultText: models.resultText(getApp().lang, 'expired') });
    }
  },

  // The pill text is the whole translated sentence ("Expires in 14:28" / "14:28 后过期"): the {t} slot is filled
  // here because a .wxml binding cannot interpolate, and word order differs per language.
  leftData(lang, s) {
    const left = countdown.mmss(s);
    return { left, leftText: i18n.t(lang, 'approve.expires', { t: left }) };
  },

  toggleDetails() { this.setData({ showDetails: !this.data.showDetails }); },

  async approve() {
    if (!this.data.ok || !this.data.mode || this.data.busy) return;
    const app = getApp();
    const lang = app.lang;
    this.setData({ busy: true, error: '' });
    try {
      const res = await wxa.startSoter(soter.startOptions(this.data.mode, this.check.challenge, this.check.authContent));
      const body = soter.checkResult(res, this.check.challenge);
      // A fresh code for the attester's own code2Session inside the TEE.
      body.code = await wxa.login();
      const out = await app.api.call('POST', `/approvals/${encodeURIComponent(this.id)}/soter`, body);
      clearInterval(this.timer);
      this.setData({ busy: false, ok: false, result: out.state, resultText: models.resultText(lang, out.state) });
    } catch (e) {
      this.setData({ busy: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },

  async reject() {
    if (this.data.busy) return;
    const app = getApp();
    const lang = app.lang;
    this.setData({ busy: true, error: '' });
    try {
      const out = await app.api.call('POST', `/approvals/${encodeURIComponent(this.id)}/reject`);
      clearInterval(this.timer);
      this.setData({ busy: false, ok: false, result: out.state, resultText: models.resultText(lang, out.state) });
    } catch (e) {
      this.setData({ busy: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },
});
