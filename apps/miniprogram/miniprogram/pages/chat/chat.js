// Chat with the agent (spec 07): quick chips, the answer and the tools it called. The agent reaches the money only
// through mcp, inside the mandate; anything beyond it comes back here as an approval to make.
const i18n = require('../../lib/i18n.js');
const chat = require('../../lib/chat.js');

Page({
  data: { t: {}, chips: [], messages: [], input: '', busy: false, error: '' },

  async onLoad() {
    const app = getApp();
    await app.ready;
    this.setData({ t: i18n.table(app.lang), chips: chat.chips(app.lang) });
    wx.setNavigationBarTitle({ title: i18n.t(app.lang, 'chat.title') });
  },

  onInput(e) { this.setData({ input: e.detail.value }); },
  sendChip(e) { return this.ask(e.currentTarget.dataset.text); },
  send() { return this.ask(this.data.input); },

  async ask(text) {
    const message = String(text || '').trim();
    if (!message || this.data.busy) return;
    const app = getApp();
    const lang = app.lang;
    this.setData({ busy: true, input: '', error: '', messages: this.data.messages.concat([{ who: 'me', text: message, tools: '' }]) });
    let reply;
    try {
      const turn = await app.api.chat(message);
      reply = turn.error
        ? { who: 'agent', text: `(${turn.error})`, tools: '' }
        : { who: 'agent', text: turn.text || i18n.t(lang, 'chat.noAnswer'), tools: turn.tools.length ? i18n.t(lang, 'chat.tools', { list: turn.tools.join(', ') }) : '' };
    } catch (e) {
      reply = { who: 'agent', text: `(${e.message})`, tools: '' };
    }
    this.setData({ busy: false, messages: this.data.messages.concat([reply]) });
  },
});
