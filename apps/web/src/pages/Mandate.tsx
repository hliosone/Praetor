// The mandate (spec 07): the current policy in plain words, the bank's caps alongside, an editable form whose
// proposal goes through the bank's FISCO check, then the owner's passkey and the bank's co-signature.
import { useEffect, useState } from 'react';
import { encodePolicy, OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { api, usd, type Prepared } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { signAndSubmit } from '../lib/passkey.js';
import { policyFromJson, type PolicyJson } from '../lib/policy.js';

type Caps = { perTx: string; daily: string; monthly: string };
const FIELDS = [['autoCap', 'Pay alone up to'], ['hardCap', 'Never more than'], ['dailyBudget', 'Daily budget'], ['monthlyBudget', 'Monthly budget'], ['bufferUsdc', 'Keep at least (USDC)'], ['maxTradeUsd', 'Largest rebalance']] as const;

export function Mandate() {
  const { t } = useI18n();
  const cur = useLoad(() => api<{ policy: PolicyJson | null; caps: Caps; spent: Record<string, string> }>('GET', '/policy'), []);
  const [form, setForm] = useState<PolicyJson>();
  const [msg, setMsg] = useState<string>();
  useEffect(() => { if (cur.data?.policy) setForm(cur.data.policy); }, [cur.data]);
  if (!cur.data) return <p className="muted">{t('common.loading')}...</p>;
  const p = cur.data.policy;
  return (
    <div className="grid two">
      <section className="panel stack">
        <h1 style={{ fontSize: 'var(--s-30)' }}>{t('mandate.title')}</h1>
        {p ? (
          <ul>
            <li>Your agent pays up to <b>{usd(p.autoCap)} USDC</b> without asking you, never more than <b>{usd(p.hardCap)}</b> at once.</li>
            <li>At most <b>{usd(p.dailyBudget)}</b> a day and <b>{usd(p.monthlyBudget)}</b> a month, {p.dailyCount} payments a day.</li>
            <li>It always keeps <b>{usd(p.bufferUsdc)} USDC</b> available.</li>
            <li>It rebalances at most {p.maxRebalancesPerDay} time(s) a day, {usd(p.maxTradeUsd)} USD each, slippage {p.maxSlippageBps / 100}%.</li>
            <li>Known payees: {p.payees.length}; merchants: {p.merchants.length}. Valid until {new Date(Number(p.validUntil) * 1000).toLocaleDateString()}.</li>
          </ul>
        ) : <p className="muted">No policy yet.</p>}
        <h2>{t('mandate.caps')}</h2>
        <p>Per payment {usd(cur.data.caps.perTx)}, daily {usd(cur.data.caps.daily)}, monthly {usd(cur.data.caps.monthly)} USDC.</p>
      </section>
      {form && (
        <form className="panel stack" onSubmit={async (e) => {
          e.preventDefault();
          setMsg(undefined);
          try {
            const r = await api<Prepared & { ok: boolean; failedRule?: number }>('POST', '/policy/propose', { policy: form });
            if (!r.ok) return setMsg(`The bank's check on FISCO refused it (rule ${r.failedRule}).`);
            setMsg((await signAndSubmit(r, K.SET_POLICY, encodePolicy(policyFromJson(form)))).success ? 'Mandate updated on Base.' : 'Refused on Base.');
            void cur.reload();
          } catch (err) { setMsg((err as Error).message); }
        }}>
          <h2>{t('mandate.propose')}</h2>
          {FIELDS.map(([k, label]) => (
            <label className="field" key={k}>{label} (USDC)
              <input inputMode="decimal" value={Number(BigInt(form[k])) / 1e6} onChange={(e) => setForm({ ...form, [k]: String(BigInt(Math.round(Number(e.target.value || 0) * 1e6))) })} />
            </label>
          ))}
          <button className="primary">{t('mandate.propose')}</button>
          {msg && <p role="status">{msg}</p>}
        </form>
      )}
    </div>
  );
}
