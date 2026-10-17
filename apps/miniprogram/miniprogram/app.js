// Praetor in WeChat (spec 07): the owner's daily screen. It reads through the api's /mp routes with a session from
// wx.login, and approves with SOTER over digests it recomputes itself; owner actions that need the passkey stay on the
// web app. Starting point: Alex's SOTER spike (services/approvals/soter/miniprogram/app.js login), see PREEXISTING.md.
const config = require('./config.js');
const wxa = require('./lib/wx.js');
const i18n = require('./lib/i18n.js');
const { createSession } = require('./lib/session.js');
const { createApi } = require('./lib/api.js');

App({
  onLaunch() {
    this.env = wxa.envVersion();
    const base = config.apiBase(this.env);
    const saved = wxa.getStorage('lang');
    this.lang = saved === 'en' || saved === 'zh-CN' ? saved : i18n.langOf(wxa.systemLanguage());
    this.session = createSession({ base, request: wxa.request, login: wxa.login });
    this.api = createApi({ base, request: wxa.request, session: this.session });
    this.loginError = null;
    this.ready = this.signIn();
  },

  /** Signs in again (after a link, or when the first attempt failed); pages await app.ready. */
  signIn() {
    this.ready = this.session.login().then(() => { this.loginError = null; }, (e) => { this.loginError = e; });
    return this.ready;
  },

  setLang(lang) {
    this.lang = lang;
    wxa.setStorage('lang', lang);
  },

  webUrl(path) {
    return config.webUrl(this.env, path);
  },
});
