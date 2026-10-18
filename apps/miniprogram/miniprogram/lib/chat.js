// The agent chat (spec 07): the api relays agent-runner's server-sent events (started, then result or error); a turn
// arrives whole, so the page reads the body once it is complete.
const i18n = require('./i18n.js');

function parseSse(text) {
  const blocks = String(text || '').split(/\n\n/);
  for (const b of blocks) {
    const event = (/^event: (\w+)$/m.exec(b) || [])[1];
    const data = (/^data: (.*)$/m.exec(b) || [])[1];
    if (!data || (event !== 'result' && event !== 'error')) continue;
    let j;
    try {
      j = JSON.parse(data);
    } catch (e) {
      continue;
    }
    if (event === 'error') return { error: String(j.error || 'error') };
    const tools = Array.isArray(j.tools) ? j.tools.map((t) => String(t.tool || '').replace(/^praetor_/, '')) : [];
    return { text: String(j.text || ''), tools };
  }
  return { text: '', tools: [] };
}

// No chip names a payee: a new account has none, so "Pay the café 12.50" was a dead end (issue #10). The pay chip asks
// who the agent can pay, which get_mandate answers on any account.
function chips(lang) {
  return ['doing', 'pay', 'rebalance'].map((key) => ({ key, text: i18n.t(lang, `chat.chips.${key}`) }));
}

module.exports = { parseSse, chips };
