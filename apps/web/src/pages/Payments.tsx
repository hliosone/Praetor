// Standing orders (spec 06 F7): the orders on-chain with their merchant, the agent's proposals, a form to add one
// (owner + bank), trigger when due (anyone), cancel (owner alone).
import { useState } from 'react';
import { encodePolicy, OwnerActionKind as K } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { api, usd, type Prepared } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { signAndSubmit } from '../lib/passkey.js';
import { policyFromJson, type PolicyJson } from '../lib/policy.js';

type Order = { id: number; payee: string; amount: string; period: number; nextDue: string; rail: number; merchant: string | null; active: boolean };
type Proposal = { id: string; merchant: string | null; payee: string | null; amount: string; period: string; summary: string; state: string };

export function Payments() {
  const { t } = useI18n();
  const l = useLoad(() => api<{ orders: Order[]; proposals: Proposal[] }>('GET', '/standing-orders'), [], 8000);
  const [merchant, setMerchant] = useState('KOWLOON-LETTINGS');
  const [amount, setAmount] = useState('1200');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [msg, setMsg] = useState<string>();
  const pol = useLoad(() => api<{ policy: PolicyJson | null }>('GET', '/policy'), []);
  const [payeeName, setPayeeName] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  const act = async (fn: () => Promise<string>) => { setMsg(undefined); try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message); } void l.reload(); void pol.reload(); };
  // A new payee changes the mandate (owner + bank's FISCO check); its name only helps the agent find it.
  const addPayee = async () => {
    const cur = pol.data?.policy;
    if (!cur) throw new Error('set a policy first');
    const address = payeeAddress.trim() as `0x${string}`;
    const next = { ...cur, payees: [...cur.payees, address] };
    const r = await api<Prepared & { ok: boolean; failedRule?: number }>('POST', '/policy/propose', { policy: next });
    if (!r.ok) return `The bank's check on FISCO refused it (rule ${r.failedRule}).`;
    if (!(await signAndSubmit(r, K.SET_POLICY, encodePolicy(policyFromJson(next)))).success) return 'Refused on Base.';
    await api('POST', '/payees/label', { address, label: payeeName.trim() });
    setPayeeName('');
    setPayeeAddress('');
    return `${payeeName.trim()} added to your payees.`;
  };
  const sign = async (body: unknown) => ((await signAndSubmit(await api<Prepared>('POST', '/standing-orders/propose', body), K.ADD_STANDING_ORDER)).success ? 'Standing order set on Base.' : 'Refused on Base.');
  return (
    <div className="stack">
      <section className="panel">
        <h1 style={{ fontSize: 'var(--s-30)' }}>{t('payments.title')}</h1>
        <table>
          <thead><tr><th>#</th><th>To</th><th className="num">USDC</th><th>Every</th><th>Next due</th><th /></tr></thead>
          <tbody>
            {l.data?.orders.map((o) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{o.merchant ?? <span className="mono">{o.payee}</span>}</td>
                <td className="num">{usd(o.amount)}</td>
                <td>{o.period >= 2_592_000 ? 'month' : 'week'}</td>
                <td>{o.active ? new Date(Number(o.nextDue) * 1000).toLocaleString() : 'cancelled'}</td>
                <td className="row">
                  {o.active && <button onClick={() => act(async () => ((await api<{ success: boolean }>('POST', `/standing-orders/${o.id}/trigger`)).success ? 'Paid.' : 'Not due yet.'))}>{t('payments.trigger')}</button>}
                  {o.active && <button className="danger" onClick={() => act(async () => ((await signAndSubmit(await api<Prepared>('POST', '/owner-actions/prepare', { kind: K.CANCEL_STANDING_ORDER, id: o.id }), K.CANCEL_STANDING_ORDER)).success ? 'Cancelled.' : 'Refused.'))}>{t('payments.cancel')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {l.data?.proposals.filter((p) => p.state === 'pending').map((p) => (
          <div className="card row between" key={p.id} style={{ marginTop: '0.75rem' }}>
            <span>Your agent proposes: {p.summary}</span>
            <button className="primary" onClick={() => act(() => sign({ proposalId: p.id }))}>Sign</button>
          </div>
        ))}
      </section>
      <section className="grid two">
      <section className="panel stack">
        <h2>{t('payments.payees')}</h2>
        {pol.data?.policy?.payees.length ? (
          <ul className="mono small">{pol.data.policy.payees.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : <p className="muted">{t('home.none')}</p>}
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void act(addPayee); }}>
          <label className="field">{t('payments.payeeName')}<input required maxLength={64} value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></label>
          <label className="field">{t('payments.payeeAddress')}<input required pattern="0x[0-9a-fA-F]{40}" value={payeeAddress} onChange={(e) => setPayeeAddress(e.target.value)} className="mono" /></label>
          <button className="primary">{t('payments.addPayee')}</button>
        </form>
      </section>
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); void act(() => sign({ merchant, amount: String(BigInt(Math.round(Number(amount) * 1e6))), period })); }}>
        <h2>{t('payments.add')}</h2>
        <label className="field">Merchant<select value={merchant} onChange={(e) => setMerchant(e.target.value)}>
          <option value="KOWLOON-LETTINGS">Kowloon Lettings (Alipay+, mock)</option>
          <option value="HK-ELECTRIC">HK Electric (WeChat Pay, mock)</option>
        </select></label>
        <label className="field">Amount (USDC)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field">Every<select value={period} onChange={(e) => setPeriod(e.target.value as 'monthly' | 'weekly')}><option value="monthly">month</option><option value="weekly">week</option></select></label>
        <button className="primary">{t('payments.add')}</button>
      </form>
      </section>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
