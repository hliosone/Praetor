// Chat with the agent (spec 07): the api relays agent-runner's server-sent events; each turn shows the agent's
// answer and the tools it called. The agent reaches the money only through mcp, inside the mandate.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { installAgent, prepareRotation, stopAgent, type MandateDraft, type NewAgent } from '../lib/agent.js';

type Turn = { text: string; tools: { tool: string; status: string; output?: unknown }[] };
type Line = { who: 'me' | 'agent'; text: string; tools?: Turn['tools'] };

/** The approval a refused payment opened: mcp's tool text names its request ("Request <uuid> is waiting for the owner"). */
const approvalOf = (output: unknown) => /Request ([0-9a-f-]{36}) is waiting for the owner/.exec(typeof output === 'string' ? output : JSON.stringify(output ?? ''))?.[1];

const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('praetor_csrf='))?.slice('praetor_csrf='.length) ?? '';

export function Agent() {
  const { t } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  // The chat scrolls inside its own box: keep the newest message in view, or on a phone the reply sits below the box.
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [lines, thinking]);
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
    setThinking(true);
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
      setThinking(false);
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
      <div ref={log} className="chat" role="log" aria-live="polite" aria-label={t('agent.title')} tabIndex={0}>
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.who}`}>
            {l.text}
            {l.tools?.map((tool, j) => <div className="tool" key={j}>{tool.tool.replace(/^praetor_/, '')}: {tool.status}</div>)}
            {l.tools?.map((tool) => approvalOf(tool.output)).filter(Boolean).map((id) => <Link key={id} className="button primary" to={`/approve/${id}`}>{t('agent.approve')}</Link>)}
          </div>
        ))}
        {thinking && (
          <div className="bubble agent muted typing" role="status" data-testid="agent-typing">
            <span className="dots" aria-hidden="true"><span className="dot" /><span className="dot" /><span className="dot" /></span>{t('agent.thinking')}
          </div>
        )}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <input aria-label={t('agent.placeholder')} placeholder={t('agent.placeholder')} value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={busy}>{t('agent.send')}</button>
      </form>
    </section>
    </div>
  );
}
