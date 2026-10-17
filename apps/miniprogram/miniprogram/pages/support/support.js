// The SOTER support probe (spec 07, kept for debugging): checkIsSupportSoterAuthentication and, per mode,
// checkIsSoterEnrolledInDevice. From Alex's spike (services/approvals/soter/miniprogram/pages/support/support.js), see
// PREEXISTING.md; unlike the spike it sends nothing anywhere (device details stay on the phone).
const i18n = require('../../lib/i18n.js');
const wxa = require('../../lib/wx.js');

const settle = (p) => p.then((r) => r, (e) => e);

Page({
  data: { t: {}, out: '' },

  async onLoad() {
    const app = getApp();
    await app.ready;
    this.setData({ t: i18n.table(app.lang) });
    wx.setNavigationBarTitle({ title: i18n.t(app.lang, 'support.title') });
    const support = await settle(new Promise((resolve, reject) => wx.checkIsSupportSoterAuthentication({ success: resolve, fail: reject })));
    const enrolled = {};
    for (const mode of ['fingerPrint', 'facial']) enrolled[mode] = await settle(wxa.soterEnrolled(mode));
    this.setData({ out: JSON.stringify({ support, enrolled }, null, 2) });
  },
});
