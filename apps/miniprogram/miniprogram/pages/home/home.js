// Home (spec 07): total, the allocation rings (canvas 2D), the status pill, the last decisions and what waits for the
// owner. Refreshes every 15 s while shown; a WeChat user not linked yet sees how to link.
const i18n = require('../../lib/i18n.js');
const models = require('../../lib/models.js');
const rings = require('../../lib/rings.js');
const wxa = require('../../lib/wx.js');

const REFRESH_MS = 15000;
const RING_SIZE = 180;

Page({
  data: { t: {}, loading: true, linked: false, error: '', total: '', assets: [], pill: {}, frozen: false, decisions: [], pending: [] },

  onShow() {
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  },
  onHide() { clearInterval(this.timer); },
  onUnload() { clearInterval(this.timer); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },

  async refresh() {
    const app = getApp();
    await app.ready;
    const lang = app.lang;
    this.setData({ t: i18n.table(lang) });
    wx.setNavigationBarTitle({ title: i18n.t(lang, 'home.title') });
    if (!app.session.account()) {
      this.setData({ loading: false, linked: false, error: app.loginError ? i18n.t(lang, 'common.error', { e: app.loginError.message }) : '' });
      return;
    }
    try {
      const [config, portfolio, status, activity, approvals] = await Promise.all([
        app.api.call('GET', '/config'), app.api.call('GET', '/portfolio'), app.api.call('GET', '/status'),
        app.api.call('GET', '/activity?limit=5'), app.api.call('GET', '/approvals?state=pending'),
      ]);
      this.setData(Object.assign({ loading: false, linked: true, error: '' }, models.homeModel(lang, { config, portfolio, status, activity, approvals })));
      this.drawRings(portfolio.assets);
    } catch (e) {
      this.setData({ loading: false, error: i18n.t(lang, 'common.error', { e: e.message }) });
    }
  },

  drawRings(assets) {
    wx.createSelectorQuery().select('#rings').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const dpr = wxa.windowInfo().pixelRatio || 2;
      canvas.width = RING_SIZE * dpr;
      canvas.height = RING_SIZE * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, RING_SIZE, RING_SIZE);
      rings.draw(ctx, rings.geometry(assets.map((a) => ({ symbol: a.symbol, weightBps: a.weightBps, band: a.band })), { size: RING_SIZE, stroke: 12, gap: 8 }));
    });
  },

  openApproval(e) { wxa.navigate(`/pages/approve/approve?id=${encodeURIComponent(e.currentTarget.dataset.id)}`); },
  goChat() { wxa.navigate('/pages/chat/chat'); },
  goActivity() { wxa.navigate('/pages/activity/activity'); },
  goPayments() { wxa.navigate('/pages/payments/payments'); },
  goSettings() { wxa.navigate('/pages/settings/settings'); },
  goLink() { wxa.navigate('/pages/link/link'); },
});
