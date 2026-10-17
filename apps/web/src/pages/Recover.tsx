// Lost every passkey (spec 06 F10 step 6): a new passkey for the account of this email, then the bank's own identity
// check; if it matches, the bank schedules the new key and, 48 h later unless a remaining passkey cancels, anyone
// completes the recovery. Nothing here grants access: the new passkey signs in only once Base holds it.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { useI18n } from '../i18n/index.js';
import { Topbar } from '../components/Layout.js';
import { api } from '../lib/api.js';
import type { RecoveryStatus } from '../lib/devices.js';

export function Recover() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState<string>();
  const [kycUrl, setKycUrl] = useState<string>();
  const [status, setStatus] = useState<RecoveryStatus>();
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!userId) return;
    const poll = () => api<RecoveryStatus>('GET', `/recover/${userId}`).then(setStatus, () => undefined);
    void poll();
    const i = setInterval(poll, 5000);
    return () => clearInterval(i);
  }, [userId]);
  const due = status?.state === 'scheduled' && Number(status.executableAt) * 1000 <= Date.now();
  return (
    <>
      <Topbar app={false} />
      <main>
        <section className="panel stack" style={{ maxWidth: 680 }}>
          <h1 style={{ fontSize: 'var(--s-30)' }}>{t('recover.title')}</h1>
          <p className="muted">{t('recover.lede')}</p>
          {!userId ? (
            <form className="stack" onSubmit={async (e) => {
              e.preventDefault();
              setMsg(undefined);
              try {
                const o = await api<{ userId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('POST', '/recover/options', { email });
                const r = await api<{ redirectUrl: string }>('POST', '/recover/verify', { userId: o.userId, response: await startRegistration({ optionsJSON: o.options }) });
                setUserId(o.userId);
                setKycUrl(r.redirectUrl);
                window.open(r.redirectUrl, '_blank', 'noopener');
              } catch (err) { setMsg((err as Error).message); }
            }}>
              <label className="field">{t('onb.email')}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              <button className="primary">{t('recover.start')}</button>
            </form>
          ) : (
            <>
              {kycUrl && status?.state !== 'scheduled' && status?.state !== 'executed' && <p className="notice" role="status">{t('recover.kyc')} <a href={kycUrl} target="_blank" rel="noopener">{kycUrl.split('?')[0]}</a></p>}
              {status?.state === 'scheduled' && <p className="pill wait" data-testid="recovery-state">{t('recover.scheduled', { at: new Date(Number(status.executableAt) * 1000).toLocaleString() })}</p>}
              {due && <button className="primary" onClick={async () => { await api('POST', `/recover/${userId}/execute`, {}); }}>{t('recover.complete')}</button>}
              {status?.state === 'executed' && <p className="pill ok">{t('recover.done')} <Link to="/">{t('landing.signin')}</Link></p>}
              {status?.state === 'cancelled' && <p className="pill no">{t('recover.cancelled')}</p>}
            </>
          )}
          {msg && <p className="error" role="alert">{t('common.error', { e: msg })}</p>}
        </section>
      </main>
    </>
  );
}
