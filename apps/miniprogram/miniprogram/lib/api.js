// The api client of the mini program: JSON under /mp with the session's bearer token; a 401 (expired token) signs in
// again with a fresh wx.login code, once, and retries.
const chat = require('./chat.js');

class ApiError extends Error {
  constructor(status, body) {
    super(body && typeof body === 'object' && body.error ? String(body.error) : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function createApi(d) {
  async function send(method, path, body, extra) {
    const token = d.session.token();
    const go = () => d.request(Object.assign({ url: `${d.base}/mp${path}`, method, data: body, header: token ? { authorization: `Bearer ${token}` } : {} }, extra));
    let r = await go();
    if (r.statusCode === 401) {
      await d.session.login();
      const fresh = d.session.token();
      r = await d.request(Object.assign({ url: `${d.base}/mp${path}`, method, data: body, header: fresh ? { authorization: `Bearer ${fresh}` } : {} }, extra));
    }
    if (r.statusCode >= 200 && r.statusCode < 300) return r.data;
    throw new ApiError(r.statusCode, r.data);
  }

  return {
    call: (method, path, body) => send(method, path, body),
    /** The agent may take a while (a real model): text body, two-minute timeout. */
    chat: async (message) => chat.parseSse(await send('POST', '/agent/chat', { message }, { dataType: 'text', timeout: 120000 })),
  };
}

module.exports = { createApi, ApiError };
