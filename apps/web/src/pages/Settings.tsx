// Settings (spec 07): WeChat link (QR for the mini program, then the passkey confirms) and unlink (owner alone, passkey),
// language, sign out.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useNavigate } from 'react-router-dom';
import { OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { assertDigest, signAndSubmit } from '../lib/passkey.js';
import type { Prepared } from '../lib/api.js';

export function Settings() {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const [link, setLink] = useState<{ id: string; qr: string; digest: `0x${string}` }>();
  const [img, setImg] = useState<string>();
  const [msg, setMsg] = useState<string>();
  useEffect(() => { if (link) void QRCode.toDataURL(link.qr, { margin: 1, width: 240 }).then(setImg); }, [link]);
  return (
    <div className="grid two">
      <section className="panel stack">
        <h1 style={{ fontSize: 'var(--s-30)' }}>{t('settings.title')}</h1>
        <h2>{t('settings.wechat')}</h2>
        {!link ? (
          <button className="primary" onClick={async () => setLink(await api('POST', '/wechat/link/start'))}>{t('settings.wechat')}</button>
        ) : (
          <>
            {img && <img src={img} alt="WeChat link QR code" width={240} height={240} style={{ borderRadius: 12, background: '#fff', padding: 8 }} />}
            <p className="muted small">Scan with the Praetor mini program, confirm with SOTER there, then confirm here.</p>
            <button onClick={async () => {
              try {
                const r = await api<{ success: boolean }>('POST', `/wechat/link/${link.id}/confirm`, { assertion: await assertDigest(link.digest) });
                setMsg(r.success ? 'WeChat linked on Base.' : 'Refused.');
              } catch (e) { setMsg((e as Error).message); }
            }}>Confirm with my passkey</button>
          </>
        )}
        <button className="danger" onClick={async () => {
          try {
            const r = await signAndSubmit(await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.UNLINK_WECHAT }), K.UNLINK_WECHAT);
            setMsg(r.success ? 'WeChat unlinked on Base.' : 'Refused.');
          } catch (e) { setMsg((e as Error).message); }
        }}>{t('settings.unlink')}</button>
        {msg && <p role="status">{msg}</p>}
      </section>
      <section className="panel stack">
        <h2>{t('settings.language')}</h2>
        <select value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'zh-CN')} aria-label={t('settings.language')}>
          <option value="en">English</option><option value="zh-CN">简体中文</option>
        </select>
        <button onClick={async () => { await api('POST', '/auth/logout'); nav('/'); }}>Sign out</button>
      </section>
    </div>
  );
}
