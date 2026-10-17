// The mini program session (spec 05): a fresh wx.login code each time, exchanged by the api (code2Session) for a
// short-lived bearer token; the account is null until this WeChat user is linked on Base. Kept in memory only.
const { ApiError } = require('./api.js');

function createSession(d) {
  let state = { token: null, account: null, expiresAt: 0 };
  let pending = null;

  async function login() {
    const code = await d.login();
    const r = await d.request({ url: `${d.base}/mp/session`, method: 'POST', data: { code }, header: { 'content-type': 'application/json' } });
    if (r.statusCode !== 200) throw new ApiError(r.statusCode, r.data);
    state = { token: r.data.token, account: r.data.account || null, expiresAt: r.data.expiresAt };
    return state;
  }

  return {
    token: () => state.token,
    account: () => state.account,
    /** Concurrent callers share one sign-in (one wx.login code). */
    login() {
      if (!pending) pending = login().then((s) => { pending = null; return s; }, (e) => { pending = null; throw e; });
      return pending;
    },
  };
}

module.exports = { createSession };
