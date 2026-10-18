// Audit (spec 06 F8): the account's entries with both chains' references, "Verify" recomputing the chain against
// the FISCO head and the Base anchor, and the camt.053 export.
import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import { api, usd } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';

type Entry = { seq: number; kind: string; reason: string; tier?: string; baseTx?: string; fiscoTx?: string; amountUsd6?: string; atMs: number; entryHash: string };
type Verdict = { verified: boolean; entries: number; mismatchAt?: number; fisco: { seq: number; match: boolean }; anchor: { seq: number; auditSeq: number | null; match: boolean } };

export function Audit() {
  const { t } = useI18n();
  const l = useLoad(() => api<{ entries: Entry[] }>('GET', '/audit'), []);
  const [v, setV] = useState<Verdict>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row between">
          <h1 style={{ fontSize: 'var(--s-30)' }}>{t('audit.title')}</h1>
          <div className="row">
            <button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { setV(await api<Verdict>('GET', '/audit/verify')); } finally { setBusy(false); } }}>{t('audit.verify')}</button>
            <a className="button" href="/api/statements/camt053" download>{t('audit.export')}</a>
          </div>
        </div>
        {v && (
          <p className={`pill ${v.verified ? 'ok' : 'no'}`} data-testid="verdict">
            {v.verified ? t('audit.verified') : t('audit.mismatch', { n: v.mismatchAt ?? '?' })}
          </p>
        )}
        {v && <p className="muted small">{v.entries} entries; FISCO head at #{v.fisco.seq}; Base anchor #{v.anchor.seq} covers #{v.anchor.auditSeq ?? '?'}.</p>}
      </section>
      <section className="panel">
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Kind</th><th>Reason</th><th className="num">USD</th><th>Base</th><th>FISCO</th><th>When</th></tr></thead>
          <tbody>
            {l.data?.entries.slice().reverse().map((e) => (
              <tr key={e.seq}>
                <td>{e.seq}</td><td>{e.kind}</td><td>{e.reason}</td>
                <td className="num">{e.amountUsd6 ? usd(e.amountUsd6) : ''}</td>
                <td className="mono">{e.baseTx?.slice(0, 10) ?? ''}</td>
                <td className="mono">{e.fiscoTx?.slice(0, 10) ?? ''}</td>
                <td>{new Date(e.atMs).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
