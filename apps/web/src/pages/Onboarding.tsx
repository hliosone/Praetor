// Onboarding (spec 06 F1, spec 07): passkey, wallet, KYC, suitability, the agent key in the TEE, the AgentMandate
// signed with the passkey, the agent key installed, then a first policy. One primary button per step; every
// signature is the passkey's over a digest this page shows.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodePolicy, OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { Topbar } from '../components/Layout.js';
import { api, type Prepared } from '../lib/api.js';
import { assertDigest, signAndSubmit, signUp } from '../lib/passkey.js';
import { installAgent, type MandateDraft, type NewAgent as Agent } from '../lib/agent.js';
import { defaultPolicy, policyFromJson, type Config } from '../lib/policy.js';

const STEPS = ['passkey', 'account', 'kyc', 'suitability', 'agent', 'mandate', 'policy'] as const;
type Step = (typeof STEPS)[number] | 'done';
const QUESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Onboarding() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('passkey');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState<string>();
  const [kycUrl, setKycUrl] = useState<string>();
  const [answers, setAnswers] = useState([1, 1, 1, 1, 1]);
  const [profile, setProfile] = useState<string>();
  const [agent, setAgent] = useState<Agent>();
  const [draft, setDraft] = useState<MandateDraft>();

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(undefined);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // KYC: the provider decides in its own page; this page follows the decision.
  useEffect(() => {
    if (step !== 'kyc' || !kycUrl) return;
    let live = true;
    void (async () => {
      while (live) {
        const s = await api<{ state: string; reason?: string }>('GET', '/onboarding/kyc/status').catch(() => null);
        if (s?.state === 'verified') { setStep('suitability'); return; }
        if (s?.state === 'rejected') { setError(`KYC rejected: ${s.reason ?? ''}`); return; }
        await sleep(2000);
      }
    })();
    return () => { live = false; };
  }, [step, kycUrl]);

  const idx = STEPS.indexOf(step as never);
  return (
    <>
      <Topbar app={false} />
      <main>
        <h1 style={{ fontSize: 'var(--s-30)', marginBottom: '1rem' }}>{t('onb.title')}</h1>
        <div className="stepper" aria-label="Progress">
          {STEPS.map((s, i) => <span key={s} aria-current={s === step ? 'step' : undefined} className={step === 'done' || i < idx ? 'done' : undefined}>{t(`onb.${s}`)}</span>)}
        </div>
        <section className="panel stack" style={{ maxWidth: 680 }}>
          {step === 'passkey' && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await signUp(email); setAccount(r.account); setStep('account'); })(); }}>
              <label className="field">{t('onb.email')}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
              <button className="primary" disabled={busy}>{t('onb.create')}</button>
            </form>
          )}
          {step === 'account' && (
            <>
              <p className="muted">Safe7579 <span className="mono">{account}</span></p>
              <button className="primary" disabled={busy} onClick={run(async () => {
                const p = await api<{ deployed: boolean; userOpHash: `0x${string}` }>('POST', '/onboarding/account/deploy');
                if (!p.deployed) {
                  const r = await api<{ success: boolean }>('POST', '/onboarding/account/deploy/submit', { assertion: await assertDigest(p.userOpHash) });
                  if (!r.success) throw new Error('the account was not created');
                }
                setStep('kyc');
              })}>{t('onb.deploy')}</button>
            </>
          )}
          {step === 'kyc' && (
            <>
              {!kycUrl ? (
                <button className="primary" disabled={busy} onClick={run(async () => {
                  const k = await api<{ redirectUrl: string }>('POST', '/onboarding/kyc/start', { method: 'vendor' });
                  setKycUrl(k.redirectUrl);
                  window.open(k.redirectUrl, '_blank', 'noopener');
                })}>{t('onb.kycStart')}</button>
              ) : (
                <p className="notice" role="status">{t('onb.kycWait')} <a href={kycUrl} target="_blank" rel="noopener">{kycUrl.split('?')[0]}</a></p>
              )}
            </>
          )}
          {step === 'suitability' && (
            <>
              <p>{t('onb.answers')}</p>
              <p className="muted small">{t('onb.scoring')}</p>
              {/* Option i is worth i points, as the bank scores it (scoreSuitability: 0 cautious to 2 risk-seeking). */}
              {QUESTIONS.map((q, i) => (
                <label className="field" key={q}>{`${i + 1}. ${t(`onb.${q}`)}`}
                  <select value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? Number(e.target.value) : a)))}>
                    {[0, 1, 2].map((v) => <option key={v} value={v}>{t(`onb.${q}.a${v}`)}</option>)}
                  </select>
                </label>
              ))}
              <button className="primary" disabled={busy} onClick={run(async () => {
                const r = await api<{ riskProfile: string }>('POST', '/onboarding/suitability', { answers });
                setProfile(r.riskProfile);
                setStep('agent');
              })}>{t('onb.saveProfile')}</button>
            </>
          )}
          {step === 'agent' && (
            <>
              {profile && <p className="muted">Profile: {profile}</p>}
              <button className="primary" disabled={busy} onClick={run(async () => {
                setAgent(await api<Agent>('POST', '/onboarding/agent/create'));
                setDraft(await api('POST', '/onboarding/kya/draft'));
                setStep('mandate');
              })}>{t('onb.createAgent')}</button>
            </>
          )}
          {step === 'mandate' && agent && draft && (
            <>
              <dl className="grid two small">
                <div><dt className="label">Agent key</dt><dd className="mono">{agent.agentKey}</dd></div>
                <div><dt className="label">TEE measurement {agent.simulator ? '(simulator)' : ''}</dt><dd className="mono">{agent.measurement.slice(0, 22)}...</dd></div>
                <div><dt className="label">Agent DID</dt><dd className="mono">{agent.agentWeId}</dd></div>
                <div><dt className="label">Scopes</dt><dd>{String((draft.claim.scopes as string[] | undefined)?.join(', ') ?? '')}</dd></div>
              </dl>
              <p className="muted small">{t('onb.review')}: <span className="mono">{draft.challenge}</span></p>
              <button className="primary" disabled={busy} onClick={run(async () => {
                await installAgent(agent, draft);
                setStep('policy');
              })}>{t('onb.sign')}</button>
            </>
          )}
          {step === 'policy' && (
            <button className="primary" disabled={busy} onClick={run(async () => {
              const cfg = await api<Config>('GET', '/config');
              const policy = defaultPolicy(cfg);
              const r = await api<Prepared & { ok: boolean; failedRule?: number }>('POST', '/policy/propose', { policy });
              if (!r.ok) throw new Error(`the bank's FISCO check refused rule ${r.failedRule}`);
              if (!(await signAndSubmit(r, K.SET_POLICY, encodePolicy(policyFromJson(policy)))).success) throw new Error('the policy was not set');
              setStep('done');
            })}>{t('onb.policySet')}</button>
          )}
          {step === 'done' && (
            <>
              <p className="pill ok">{t('onb.done')}</p>
              <button className="primary" onClick={() => nav('/home')}>{t('nav.home')}</button>
            </>
          )}
          {busy && <p className="muted" role="status">{t('common.loading')}...</p>}
          {error && <p className="error" role="alert">{t('common.error', { e: error })}</p>}
        </section>
      </main>
    </>
  );
}
