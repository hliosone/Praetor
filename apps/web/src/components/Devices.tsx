// Settings: the account's passkeys (active once Base holds them) and a pending recovery, which any of them can cancel.
import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { addDevice, cancelRecovery, type RecoveryStatus } from '../lib/devices.js';
import { enablePush } from '../lib/push.js';

export function Devices() {
  const { t } = useI18n();
  const keys = useLoad(() => api<{ passkeys?: { credIdHash: string; active: boolean }[] }>('GET', '/passkeys'), []);
  const recovery = useLoad(() => api<RecoveryStatus>('GET', '/recovery'), [], 15_000);
  const [msg, setMsg] = useState<string>();
  const act = (fn: () => Promise<string>) => async () => {
    setMsg(undefined);
    try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message); } finally { void keys.reload(); void recovery.reload(); }
  };
  return (
    <section className="panel stack">
      <h2>{t('settings.passkeys')}</h2>
      <ul className="small">
        {keys.data?.passkeys?.map((k) => (
          <li key={k.credIdHash} className="row between"><span className="mono">{k.credIdHash.slice(0, 18)}...</span><span className={`pill ${k.active ? 'ok' : 'wait'}`}>{k.active ? t('settings.active') : t('settings.pending')}</span></li>
        ))}
      </ul>
      <button onClick={act(async () => ((await addDevice()) ? t('settings.deviceAdded') : 'Refused on Base.'))}>{t('settings.addDevice')}</button>
      <h2>{t('settings.notifications')}</h2>
      <p className="muted small">{t('settings.notificationsText')}</p>
      <button onClick={act(async () => { await enablePush(); return t('settings.pushOn'); })}>{t('settings.enablePush')}</button>
      {recovery.data?.state === 'scheduled' && recovery.data.payloadHash && (
        <div className="card stack" role="alert">
          <p>{t('settings.recoveryPending', { at: new Date(Number(recovery.data.executableAt) * 1000).toLocaleString() })}</p>
          <button className="danger" onClick={act(async () => ((await cancelRecovery(recovery.data!.payloadHash!)) ? t('settings.recoveryCancelled') : 'Refused on Base.'))}>{t('settings.cancelRecovery')}</button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
