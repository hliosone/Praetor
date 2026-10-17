// The thin layer over wx.*: every WeChat API the pages use, as promises, read from the global wx at call time so the
// logic runs in Node tests against a fake.
function call(name, opts) {
  return new Promise((resolve, reject) => {
    wx[name](Object.assign({}, opts, { success: resolve, fail: reject }));
  });
}

module.exports = {
  login: () => call('login').then((r) => r.code),
  /** Resolves with {statusCode, data} for any HTTP status; rejects only when the request did not complete. */
  request: (o) => call('request', o),
  scanCode: () => call('scanCode', { onlyFromCamera: true, scanType: ['qrCode'] }).then((r) => r.result),
  soterSupport: () => call('checkIsSupportSoterAuthentication').then((r) => r.supportMode),
  soterEnrolled: (mode) => call('checkIsSoterEnrolledInDevice', { checkAuthMode: mode }),
  /** Both callbacks carry errCode: the caller decides (lib/soter.js checkResult). */
  startSoter: (o) => new Promise((resolve) => {
    wx.startSoterAuthentication(Object.assign({}, o, { success: resolve, fail: resolve }));
  }),
  copy: (data) => call('setClipboardData', { data }),
  toast: (title) => wx.showToast({ title, icon: 'none' }),
  navigate: (url) => call('navigateTo', { url }),
  getStorage: (key) => {
    try {
      return wx.getStorageSync(key);
    } catch (e) {
      return '';
    }
  },
  setStorage: (key, value) => {
    try {
      wx.setStorageSync(key, value);
    } catch (e) {
      // storage full or blocked: the choice is not remembered, nothing else depends on it
    }
  },
  envVersion: () => {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion;
    } catch (e) {
      return 'develop';
    }
  },
  systemLanguage: () => (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).language,
  windowInfo: () => (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()),
};
