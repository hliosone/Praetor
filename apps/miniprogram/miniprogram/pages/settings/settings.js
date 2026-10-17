// Settings (spec 07): language, the linked account, notifications, and Unlink. Unlinking is an owner action
// (UNLINK_WECHAT, owner alone) signed with the passkey in the web app, never from this phone: the button copies that
// page's link and says so. The SOTER probe is offered outside release builds only.
const i18n = require('../../lib/i18n.js');
const wxa = require('../../lib/wx.js');

Page({
  data: { t: {}, lang: 'en', account: '', showSupport: false },

  async onShow() {
    const app = getApp();
    await app.ready;
    this.render();
    this.setData({ account: app.session.account() || '', showSupport: app.env !== 'release' });
  },

  render() {
    const lang = getApp().lang;
    this.setData({ lang, t: i18n.table(lang) });
    wx.setNavigationBarTitle({ title: i18n.t(lang, 'settings.title') });
  },

  setLang(e) {
    getApp().setLang(e.currentTarget.dataset.lang === 'zh-CN' ? 'zh-CN' : 'en');
    this.render();
  },

  async unlink() {
    const app = getApp();
    await wxa.copy(app.webUrl('/settings'));
    wx.showModal({ title: i18n.t(app.lang, 'settings.unlink'), content: i18n.t(app.lang, 'settings.unlinkText'), showCancel: false });
  },

  goSupport() { wxa.navigate('/pages/support/support'); },
});
