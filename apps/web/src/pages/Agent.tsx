// Chat with the agent (spec 07): the api relays agent-runner's server-sent events; each turn shows the agent's
// answer and the tools it called. The agent reaches the money only through mcp, inside the mandate.
import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { installAgent, prepareRotation, stopAgent, type MandateDraft, type NewAgent } from '../lib/agent.js';

type Turn = { text: string; tools: { tool: string; status: string; output?: unknown }[] };
type Line = { who: 'me' | 'agent'; text: string; tools?: Turn['tools'] };

const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('praetor_csrf='))?.slice('praetor_csrf='.length) ?? '';

export function Agent() {
  const { t } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const me = useLoad(() => api<{ agentKey: `0x${string}`; validUntil: string; riskProfile: string; kycLevel: number; jurisdiction: string; revoked?: boolean }>('GET', '/agent'), []);
  const [rotation, setRotation] = useState<{ agent: NewAgent; draft: MandateDraft }>();
  const [msg, setMsg] = useState<string>();
  const act = (fn: () => Promise<string>) => async () => {
    setMsg(undefined);
    setBusy(true);
    try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); void me.reload(); }
  };
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
    <div className="grid two">
    <section className="panel stack">
      <h2>{t('agent.identity')}</h2>
      {me.data && (
        <dl className="small grid two">
          <div><dt className="label">Key</dt><dd className="mono" data-testid="agent-key">{me.data.agentKey}</dd></div>
          <div><dt className="label">KYA</dt><dd>level {me.data.kycLevel}, {me.data.riskProfile}, {me.data.jurisdiction}</dd></div>
        </dl>
      )}
      {!rotation ? (
        <div className="row">
          <button className="danger" disabled={busy || !me.data} onClick={act(async () => ((await stopAgent(me.data!.agentKey)) ? t('agent.stopped') : 'Refused on Base.'))}>{t('agent.stop')}</button>
          <button disabled={busy} onClick={act(async () => { setRotation(await prepareRotation()); return t('agent.review'); })}>{t('agent.rotate')}</button>
        </div>
      ) : (
        <div className="card stack">
          <dl className="small grid two">
            <div><dt className="label">New key</dt><dd className="mono" data-testid="new-agent-key">{rotation.agent.agentKey}</dd></div>
            <div><dt className="label">TEE measurement {rotation.agent.simulator ? '(simulator)' : ''}</dt><dd className="mono">{rotation.agent.measurement.slice(0, 22)}...</dd></div>
            <div><dt className="label">Agent DID</dt><dd className="mono">{rotation.agent.agentWeId}</dd></div>
          </dl>
          <p className="muted small">{t('onb.review')}: <span className="mono">{rotation.draft.challenge}</span></p>
          <button className="primary" disabled={busy} onClick={act(async () => { await installAgent(rotation.agent, rotation.draft); setRotation(undefined); return t('agent.rotated'); })}>{t('onb.sign')}</button>
        </div>
      )}
      {busy && <p className="muted" role="status">{t('common.loading')}...</p>}
      {msg && <p role="status">{msg}</p>}
    </section>
    <section className="panel stack">
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
    </div>
  );
}
