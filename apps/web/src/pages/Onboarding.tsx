// Onboarding (spec 06 F1, spec 07): passkey, wallet, KYC, suitability, the agent key in the TEE, the AgentMandate
// signed with the passkey, the agent key installed, then a first policy. One primary button per step; every
// signature is the passkey's over a digest this page shows. A signed-in account resumes at its first unfinished step,
// which the api derives from the bank and Base: a phone may discard this tab while the KYC runs in another one.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { encodePolicy, OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { Topbar } from '../components/Layout.js';
import { api, type Me, type Prepared } from '../lib/api.js';
import { assertDigest, signAndSubmit, signUp } from '../lib/passkey.js';
import { installAgent, setAgentKey, type MandateDraft, type NewAgent as Agent } from '../lib/agent.js';
import { defaultPolicy, policyFromJson, type Config } from '../lib/policy.js';

const STEPS = ['passkey', 'account', 'kyc', 'suitability', 'agent', 'mandate', 'policy'] as const;
type Step = (typeof STEPS)[number] | 'done';
const QUESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Onboarding() {
  const { t } = useI18n();
  const nav = useNavigate();
  // Unknown until the api says where this account stands: nothing to click before that.
  const [step, setStep] = useState<Step>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState<string>();
  const [kycUrl, setKycUrl] = useState<string>();
  const [answers, setAnswers] = useState([1, 1, 1, 1, 1]);
  const [profile, setProfile] = useState<string>();
  const [agent, setAgent] = useState<Agent>();
  const [draft, setDraft] = useState<MandateDraft>();
  // Resumed after the AgentMandate reached Base: the KYA's agent key, still to be installed.
  const [kyaKey, setKyaKey] = useState<`0x${string}`>();

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(undefined);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  // Without a session, onboarding starts with the passkey; with one, at the account's first unfinished step.
  useEffect(() => {
    let live = true;
    void (async () => {
      const me = await api<Me>('GET', '/me').catch(() => null);
      if (!live) return;
      if (!me) { setStep('passkey'); return; }
      try {
        const { step: next } = await api<{ step: Step }>('GET', '/onboarding/step');
        const kya = next === 'mandate' ? (await api<{ agentKey: `0x${string}` }>('GET', '/agent')).agentKey : undefined;
        if (!live) return;
        setAccount(me.account);
        setKyaKey(kya);
        setStep(next);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => { live = false; };
  }, []);

  // KYC: the provider decides in its own page, in another tab; this page follows the bank's decision, also after a
  // reload that lost the session it started.
  useEffect(() => {
    if (step !== 'kyc') return;
    let live = true;
    void (async () => {
      while (live) {
        const s = await api<{ state: string; reason?: string }>('GET', '/onboarding/kyc/status').catch(() => null);
        if (!live) return;
        if (s?.state === 'verified' || s?.state === 'issued') { setError(undefined); setStep(s.state === 'verified' ? 'suitability' : 'agent'); return; }
        // The bank keeps a rejection until a new session is decided: keep following a retry.
        if (s?.state === 'rejected') setError(`KYC rejected: ${s.reason ?? ''}`);
        await sleep(2000);
      }
    })();
    return () => { live = false; };
  }, [step]);

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
          {step === undefined && !error && <p className="muted" role="status">{t('common.loading')}...</p>}
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
              {/* The bank scores each answer 0 (cautious) to 2 (risk-seeking): the options keep that order. */}
              {QUESTIONS.map((q, i) => (
                <label className="field" key={q}>{`${i + 1}. ${t(`onb.${q}`)}`}
                  <select value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? Number(e.target.value) : a)))}>
                    {[0, 1, 2].map((a) => <option key={a} value={a}>{t(`onb.${q}.a${a}`)}</option>)}
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
          {step === 'mandate' && !draft && kyaKey && (
            <>
              <p>{t('onb.installKey')}</p>
              <dl className="small"><dt className="label">Agent key</dt><dd className="mono">{kyaKey}</dd></dl>
              <button className="primary" disabled={busy} onClick={run(async () => {
                await setAgentKey(kyaKey);
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

/** Where the demo KYC provider sends its own tab back (`/onboarding/kyc`): the onboarding tab notices the decision by
 *  itself, and only that tab holds the passkey session the next steps sign with. */
export function KycReturned() {
  const { t } = useI18n();
  return <main className="panel stack" style={{ maxWidth: 560, margin: '48px auto' }}><p role="status">{t('onb.kycReturned')}</p></main>;
}
