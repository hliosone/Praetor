// Activity (spec 07): the hook's decisions and the logged refusals with tier badges and reasons in words; a tap copies
// the BaseScan link (a mini program cannot open an outside page).
const i18n = require('../../lib/i18n.js');
const models = require('../../lib/models.js');
const wxa = require('../../lib/wx.js');

Page({
  data: { t: {}, loading: true, rows: [], error: '' },

  async onShow() {
    const app = getApp();
    await app.ready;
    const lang = app.lang;
    this.setData({ t: i18n.table(lang) });
    wx.setNavigationBarTitle({ title: i18n.t(lang, 'activity.title') });
    try {
      const r = await app.api.call('GET', '/activity?limit=50');
      this.setData({ loading: false, error: '', rows: models.activityRows(lang, r.items) });
    } catch (e) {
      this.setData({ loading: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },

  async copyTx(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    await wxa.copy(url);
    wxa.toast(i18n.t(getApp().lang, 'common.copied'));
  },
});
