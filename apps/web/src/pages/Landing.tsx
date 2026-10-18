// Landing (spec 07): the promise, the phone cycling through the moments that matter, the three pillars and steps.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/index.js';
import { PhoneView } from '../components/PhoneView.js';
import { Topbar } from '../components/Layout.js';
import type { PhoneScreen } from '../components/phoneScreen.js';
import { signIn } from '../lib/passkey.js';
import { api } from '../lib/api.js';

/** After sign-in: an account whose onboarding stopped half way goes back to it. When the step cannot be read, the
 *  dashboard, which links back to the onboarding while the account has no policy. */
async function landingAfterSignIn(): Promise<string> {
  const { step } = await api<{ step: string }>('GET', '/onboarding/step').catch(() => ({ step: 'done' }));
  return step === 'done' ? '/home' : '/start';
}

export function Landing() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [beat, setBeat] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) return;
    const id = setInterval(() => setBeat((b) => (b + 1) % 4), 3200);
    return () => clearInterval(id);
  }, []);
  const screens = useMemo<PhoneScreen[]>(() => [
    { kind: 'approval', title: t('phone.approve', { amount: '300' }), subtitle: t('phone.to', { payee: 'Café Lumen' }), action: 'Face ID' },
    { kind: 'approval', title: t('phone.approve', { amount: '300' }), subtitle: t('phone.to', { payee: 'Café Lumen' }), action: '✓', approved: true },
    { kind: 'portfolio', title: t('phone.portfolio'), total: '$10,000', slices: [
      { label: 'USDC', weightBps: 5300, color: '#8fb4ff' }, { label: 'tXAU', weightBps: 3200, color: '#d4af37' }, { label: 'tXAG', weightBps: 1500, color: '#c7ccd4' },
    ] },
    { kind: 'frozen', title: t('phone.frozen'), text: t('pillar.regulated.text') },
  ], [t]);

  return (
    <>
      <Topbar app={false} />
      <main>
        <section className="hero">
          <div className="stack">
            <h1>{t('landing.title')}</h1>
            <p className="lede">{t('landing.lede')}</p>
            <div className="row">
              <Link className="button primary" to="/start">{t('landing.start')}</Link>
              <button onClick={() => signIn().then(landingAfterSignIn).then((to) => nav(to), (e: Error) => setError(e.message))}>{t('landing.signin')}</button>
              <Link className="button" to="/sandbox">{t('landing.sandbox')}</Link>
              <Link className="button" to="/console">{t('landing.console')}</Link>
            </div>
            <p className="small"><Link to="/recover">{t('landing.lost')}</Link></p>
            {error && <p className="error" role="alert">{t('common.error', { e: error })}</p>}
          </div>
          <div className="stage"><PhoneView screen={screens[beat]!} label={t('phone.approve', { amount: '300' })} /></div>
        </section>
        <section className="grid three pillars" style={{ marginTop: '2rem' }}>
          {(['autonomous', 'bounded', 'regulated'] as const).map((k) => (
            <article className="card" key={k}><h3>{t(`pillar.${k}`)}</h3><p className="muted">{t(`pillar.${k}.text`)}</p></article>
          ))}
        </section>
        <section className="grid three steps" style={{ marginTop: '1rem' }}>
          {(['wallet', 'identity', 'mandate'] as const).map((k) => <article className="card" key={k}><h3>{t(`step.${k}`)}</h3></article>)}
        </section>
      </main>
    </>
  );
}
