// Chat with the agent (spec 07): the api relays agent-runner's server-sent events; each turn shows the agent's
// answer and the tools it called. The agent reaches the money only through mcp, inside the mandate.
import { useState } from 'react';
import { useI18n } from '../i18n/index.js';

type Turn = { text: string; tools: { tool: string; status: string; output?: unknown }[] };
type Line = { who: 'me' | 'agent'; text: string; tools?: Turn['tools'] };

const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('praetor_csrf='))?.slice('praetor_csrf='.length) ?? '';

export function Agent() {
  const { t } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setText('');
    setBusy(true);
    setLines((l) => [...l, { who: 'me', text: message }]);
    try {
      const r = await fetch('/api/agent/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify({ message }) });
      const body = await r.text();
      const result = body.split('\n\n').find((b) => b.startsWith('event: result'));
      const err = body.split('\n\n').find((b) => b.startsWith('event: error'));
      const turn = result ? (JSON.parse(result.slice(result.indexOf('data: ') + 6)) as Turn) : { text: err ? `(${err.slice(err.indexOf('data: ') + 6)})` : '(no answer)', tools: [] };
      setLines((l) => [...l, { who: 'agent', text: turn.text, tools: turn.tools }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack" style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 'var(--s-30)' }}>{t('agent.title')}</h1>
      <div className="chat" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.who}`}>
            {l.text}
            {l.tools?.map((tool, j) => <div className="tool" key={j}>{tool.tool.replace(/^praetor_/, '')}: {tool.status}</div>)}
          </div>
        ))}
        {busy && <div className="bubble agent muted">...</div>}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input aria-label={t('agent.placeholder')} placeholder={t('agent.placeholder')} value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy}>{t('agent.send')}</button>
      </form>
    </section>
  );
}
