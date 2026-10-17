// Payments (spec 07): the standing orders on Base (read only) and what the agent proposed. A new standing order is an
// owner action with the bank (ADD_STANDING_ORDER): it is signed with the passkey in the web app, so "Propose" copies
// that link and says so.
const i18n = require('../../lib/i18n.js');
const models = require('../../lib/models.js');
const wxa = require('../../lib/wx.js');

Page({
  data: { t: {}, loading: true, orders: [], proposals: [], error: '' },

  async onShow() {
    const app = getApp();
    await app.ready;
    const lang = app.lang;
    this.setData({ t: i18n.table(lang) });
    wx.setNavigationBarTitle({ title: i18n.t(lang, 'payments.title') });
    try {
      const r = await app.api.call('GET', '/standing-orders');
      this.setData(Object.assign({ loading: false, error: '' }, models.ordersModel(lang, r)));
    } catch (e) {
      this.setData({ loading: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },

  async propose() {
    const app = getApp();
    await wxa.copy(app.webUrl('/payments'));
    wx.showModal({ title: i18n.t(app.lang, 'payments.propose'), content: i18n.t(app.lang, 'payments.proposeText'), showCancel: false });
  },
});
