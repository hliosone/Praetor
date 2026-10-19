// Approval (spec 06 F6): the full call, why it needs a human, the digest preimage. The page recomputes the
// Tier2Approval digest itself from the preimage and refuses to sign a digest the server sent that differs from it, or
// a callHash that binds none of the calls it shows. It shows the bound call: in a rebalance that is the swap, not the
// approve before it.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { decodeFunctionData, erc20Abi, formatUnits, parseAbi } from 'viem';
import { callHash, digest, praetorDomain, reasonWords } from '@praetor/protocol';
import { useI18n } from '../i18n/index.js';
import { api, usd, type ApprovalView } from '../lib/api.js';
import { assertDigest } from '../lib/passkey.js';
import { useLoad } from '../lib/useLoad.js';
import type { Config } from '../lib/policy.js';

const SWAP = parseAbi(['function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)']);

export function Approve() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const a = useLoad(() => api<ApprovalView>('GET', `/approvals/${id}`), [id]);
  const cfg = useLoad(() => api<Config>('GET', '/config'), []);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(i); }, []);
  if (!a.data || !cfg.data) return <p className="muted">{t('common.loading')}...</p>;
  const v = a.data;
  const mine = digest(praetorDomain(cfg.data.domainName, cfg.data.mandateHook), 'Tier2Approval', {
    account: v.tier2.account, callHash: v.tier2.callHash, nonce: BigInt(v.tier2.nonce), expiresAt: BigInt(v.tier2.expiresAt),
  });
  const bound = v.calls.findIndex((c) => callHash({ account: v.tier2.account, target: c.to, value: BigInt(c.value), data: c.data }) === v.tier2.callHash.toLowerCase());
  const matches = mine === v.digest && bound >= 0;
  const call = v.calls[Math.max(bound, 0)]!;
  const c = cfg.data;
  const sym = (t: string) => ({ [c.usdc.toLowerCase()]: 'USDC', [c.txau.toLowerCase()]: 'tXAU', [c.txag.toLowerCase()]: 'tXAG' })[t.toLowerCase()] ?? t;
  const amount = (x: bigint, t: string) => (sym(t) === 'USDC' ? usd(x) : Number(formatUnits(x, 18)).toFixed(4));
  let what = `${call.to} ${call.data.slice(0, 10)}`;
  try {
    const d = decodeFunctionData({ abi: [...erc20Abi, ...SWAP], data: call.data });
    if (d.functionName === 'transfer') what = `Pay ${usd(String(d.args[1]))} USDC to ${d.args[0]}`;
    if (d.functionName === 'swap') {
      const [tokenIn, tokenOut, amountIn, minOut] = d.args;
      what = `Sell ${amount(amountIn, tokenIn)} ${sym(tokenIn)} for at least ${amount(minOut, tokenOut)} ${sym(tokenOut)}`;
    }
  } catch { /* neither a USDC transfer nor a desk swap: show the raw call */ }
  return (
    <section className="panel stack" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 'var(--s-30)' }}>{t('approve.title')}</h1>
      <p className="big" style={{ fontSize: 'var(--s-24)' }} data-testid="approval-what">{what}</p>
      <div>
        <span className="label">{t('approve.why')}</span>
        <ul data-testid="approval-why">{reasonWords(v.reason).map((w) => <li key={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</li>)}</ul>
        <p>{v.summary}</p>
      </div>
      <p className="muted small">{t('approve.expires', { s: Math.max(0, Number(v.tier2.expiresAt) - now) })}</p>
      <details>
        <summary>{t('approve.details')}</summary>
        <pre className="mono small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ calls: v.calls, tier2: v.tier2, digest: v.digest, recomputed: mine }, null, 2)}</pre>
      </details>
      {!matches && <p className="error" role="alert">The digest from the server does not match the call: not signing.</p>}
      {v.state === 'pending' && !result && (
        <div className="row">
          <button className="primary" disabled={!matches} onClick={async () => {
            try {
              const r = await api<{ state: string }>('POST', `/approvals/${id}/passkey`, { assertion: await assertDigest(mine) });
              setResult(r.state);
            } catch (e) { setError((e as Error).message); }
          }}>{t('approve.passkey')}</button>
          <button className="danger" onClick={async () => { await api('POST', `/approvals/${id}/reject`); setResult('rejected'); }}>{t('approve.reject')}</button>
        </div>
      )}
      {(result ?? (v.state !== 'pending' ? v.state : undefined)) && (
        <p className={`pill ${(result ?? v.state) === 'executed' ? 'ok' : (result ?? v.state) === 'rejected' ? 'no' : 'wait'}`} data-testid="approval-state">{result ?? v.state}</p>
      )}
      {error && <p className="error" role="alert">{t('common.error', { e: error })}</p>}
    </section>
  );
}
