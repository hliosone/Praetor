// Dashboard (spec 07): total value, the vault rings with bands, the status pill, the agent, the decision feed and
// what waits for the owner. Polls the api every few seconds: the chain is the source of truth.
import { Link } from 'react-router-dom';
import { OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { Rings } from '../components/Rings.js';
import { StatusPill, TierBadge } from '../components/StatusPill.js';
import { TxLink } from '../components/TxLink.js';
import { api, usd, type Activity, type ApprovalView, type Portfolio, type Prepared, type Status } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { signAndSubmit } from '../lib/passkey.js';
import type { Config } from '../lib/policy.js';

export function Home() {
  const { t } = useI18n();
  const portfolio = useLoad(() => api<Portfolio>('GET', '/portfolio'), [], 8000);
  const status = useLoad(() => api<Status>('GET', '/status'), [], 8000);
  const agent = useLoad(() => api<{ agentKey: string; validUntil: string; riskProfile: string; kycLevel: number; jurisdiction: string }>('GET', '/agent'), []);
  const feed = useLoad(() => api<{ items: Activity[] }>('GET', '/activity?limit=12'), [], 6000);
  const pending = useLoad(() => api<{ approvals: ApprovalView[] }>('GET', '/approvals?state=pending'), [], 5000);
  // No policy: the onboarding stopped before its last step (a discarded tab), and the way back is here.
  const policy = useLoad(() => api<{ policy: unknown }>('GET', '/policy'), []);
  const cfg = useLoad(() => api<Config>('GET', '/config'), []);

  return (
    <div className="stack">
      {policy.data && !policy.data.policy && (
        <section className="panel row between">
          <p>{t('onb.unfinished')}</p>
          <Link className="button primary" to="/start">{t('onb.finish')}</Link>
        </section>
      )}
      {/* The pill alone is easy to miss: a frozen account says what it means where the owner looks first. */}
      {status.data?.effective === 'FROZEN' && <p className="notice frozen" role="alert" data-testid="frozen-banner">{t('home.frozen')}</p>}
      <section className="grid two">
        <article className="panel stack">
          <div className="row between">
            <div><div className="label">{t('home.total')}</div><div className="big" data-testid="total">${usd(portfolio.data?.totalUsd6)}</div></div>
            {status.data && <StatusPill status={status.data} />}
          </div>
          {portfolio.data && <Rings assets={portfolio.data.assets} label={t('phone.portfolio')} />}
          {portfolio.data?.assets.some((a) => a.demoPrice) && <p className="muted small">Demo price (labelled): no live feed for this asset here.</p>}
        </article>
        <article className="panel stack">
          <h2>{t('home.pending')}</h2>
          {pending.data?.approvals.length ? pending.data.approvals.map((a) => (
            <Link key={a.id} to={`/approve/${a.id}`} className="card row between" style={{ textDecoration: 'none' }}>
              <span>{a.summary}</span><span className="pill wait">T2</span>
            </Link>
          )) : <p className="muted">{t('home.none')}</p>}
          <h2>{t('home.agent')}</h2>
          {agent.data && (
            <dl className="small grid two">
              <div><dt className="label">Key</dt><dd className="mono">{agent.data.agentKey}</dd></div>
              <div><dt className="label">KYA</dt><dd>level {agent.data.kycLevel}, {agent.data.riskProfile}, {agent.data.jurisdiction}</dd></div>
            </dl>
          )}
          <div className="row">
            <Link className="button" to="/agent">{t('home.chat')}</Link>
            <button onClick={async () => { await signAndSubmit(await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.PAUSE_AGENT }), K.PAUSE_AGENT); void status.reload(); }}>{t('home.pause')}</button>
          </div>
        </article>
      </section>
      <section className="panel">
        <h2>{t('home.feed')}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Action</th><th>Reason</th><th>Tier</th><th className="num">USD</th><th>{t('common.tx')}</th></tr></thead>
          <tbody>
            {feed.data?.items.map((i) => (
              <tr key={`${i.txHash}${i.kind}${i.reason}`}>
                <td>{i.kind === 'refusal' ? 'Refused' : 'Executed'}</td>
                <td>{i.reason}</td>
                <td><TierBadge tier={i.tier} /></td>
                <td className="num">{i.valueUsd6 ? usd(i.valueUsd6) : ''}</td>
                <td><TxLink hash={i.txHash} explorer={cfg.data?.explorer} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {(portfolio.error || status.error) && <p className="error" role="alert">{t('common.error', { e: portfolio.error ?? status.error ?? '' })}</p>}
    </div>
  );
}
