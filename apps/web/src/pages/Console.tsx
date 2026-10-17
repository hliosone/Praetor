// Consortium console (spec 07): the agents' statuses (chain data), and one panel per member (bank, regulator,
// operator) side by side. Staff sign in with their member service's passkey; every consortium signature is that
// passkey over the attestation digest, checked by the member service (the api only relays). The tracker shows who
// signed and how many signatures the action needs.
import { useState } from 'react';
import { Topbar } from '../components/Layout.js';
import { useI18n } from '../i18n/index.js';
import { useLoad } from '../lib/useLoad.js';
import { staffAssert, staffEnrol } from '../lib/staffKey.js';

type Role = 'bank' | 'regulator' | 'operator';
type Agent = { account: string; status: 'ACTIVE' | 'RESTRICTED' | 'FROZEN'; kycLevel: number; riskProfile: string; jurisdiction: string };
type Proposal = { status: number; required: number; signers: string[]; digest: `0x${string}`; primaryType?: string };
const PILL = { ACTIVE: 'ok', RESTRICTED: 'wait', FROZEN: 'no' } as const;
const PROPOSAL_STATUS = ['none', 'open', 'ready', 'closed'];

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, session?: string): Promise<T> {
  const r = await fetch(`/api/console${path}`, {
    method, headers: { 'content-type': 'application/json', ...(session ? { 'x-staff-session': session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data as { detail?: string; error?: string } | null)?.detail ?? (data as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
  return data as T;
}

function RolePanel({ role, selected, onDone }: { role: Role; selected?: string; onDone(): void }) {
  const [session, setSession] = useState<string | null>(() => sessionStorage.getItem(`praetor.staff.${role}`));
  const [label, setLabel] = useState<string>();
  const [open, setOpen] = useState<{ board: string; proposalId: string }>();
  const [proposal, setProposal] = useState<Proposal>();
  const [msg, setMsg] = useState<string>();
  const [enrol, setEnrol] = useState<string>();
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('US');
  const run = (fn: () => Promise<void>) => async () => { setMsg(undefined); try { await fn(); } catch (e) { setMsg((e as Error).message); } };
  const refresh = async (o = open) => { if (o && session) setProposal(await call<Proposal>('GET', `/${role}/proposals/${o.board}/${o.proposalId}`, undefined, session)); };
  const openAction = (action: string, params: Record<string, unknown>) => run(async () => {
    const o = await call<{ board: string; proposalId: string }>('POST', `/${role}/open`, { action, params }, session!);
    setOpen(o);
    await refresh(o);
  });

  return (
    <article className="panel stack" data-testid={`console-${role}`}>
      <div className="row between"><h2 style={{ textTransform: 'capitalize' }}>{role}</h2>{session && <span className="pill ok">{label ?? 'staff'}</span>}</div>
      {!session ? (
        <div className="stack">
          <button className="primary" onClick={run(async () => {
            const { challenge } = await call<{ challenge: `0x${string}` }>('POST', `/${role}/challenge`);
            const r = await call<{ session: string; label: string }>('POST', `/${role}/login`, { assertion: await staffAssert(challenge) });
            sessionStorage.setItem(`praetor.staff.${role}`, r.session);
            setSession(r.session);
            setLabel(r.label);
          })}>Sign in as {role} staff</button>
          <button onClick={run(async () => setEnrol(JSON.stringify(await staffEnrol(role))))}>Enrol this device</button>
          {enrol && <p className="small">Ask an enrolled {role} staff member to approve this key: <code data-testid={`enrol-${role}`}>{enrol}</code></p>}
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">Account: <span className="mono">{selected ?? 'select one in the table'}</span></p>
          <div className="row">
            <button className="danger" disabled={!selected} onClick={openAction('status', { account: selected, status: 2 })}>Freeze</button>
            <button disabled={!selected} onClick={openAction('status', { account: selected, status: 1 })}>Restrict</button>
            <button disabled={!selected} onClick={openAction('status', { account: selected, status: 0 })}>Loosen</button>
          </div>
          <div className="row">
            <input aria-label="Address to list" placeholder="0x... address" value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }} />
            <button onClick={openAction('sanctions', { target, listed: true })}>List</button>
            <button onClick={openAction('sanctions', { target, listed: false })}>Delist</button>
          </div>
          <div className="row">
            <input aria-label="Jurisdiction" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={2} style={{ width: '5rem' }} />
            <button onClick={openAction('jurisdictions', { jurisdiction: code, blocked: true })}>Block payouts</button>
            <button onClick={openAction('jurisdictions', { jurisdiction: code, blocked: false })}>Unblock</button>
          </div>
          {open && proposal && (
            <div className="card stack" data-testid={`proposal-${role}`}>
              <div className="row between">
                <span>{proposal.primaryType ?? open.board} #{open.proposalId}</span>
                <span className={`pill ${proposal.status === 2 ? 'ok' : 'wait'}`}>{proposal.signers.length} of 3 signed · needs {proposal.required} · {PROPOSAL_STATUS[proposal.status] ?? proposal.status}</span>
              </div>
              <div className="row">
                <button className="primary" onClick={run(async () => {
                  const r = await call<{ ready: boolean }>('POST', `/${role}/proposals/${open.board}/${open.proposalId}/sign`, { assertion: await staffAssert(proposal.digest) }, session);
                  setMsg(r.ready ? 'Ready: the bridge delivers it to Base.' : 'Signed: waiting for another member.');
                  await refresh();
                  onDone();
                })}>Sign with my passkey</button>
                <button onClick={run(() => refresh())}>Refresh</button>
              </div>
              <p className="small muted mono">digest {proposal.digest}</p>
            </div>
          )}
          <button onClick={() => { sessionStorage.removeItem(`praetor.staff.${role}`); setSession(null); }}>Sign out</button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}
    </article>
  );
}

export function Console() {
  const { t } = useI18n();
  const agents = useLoad(() => call<{ agents: Agent[] }>('GET', '/agents'), [], 6000);
  const [selected, setSelected] = useState<string>();
  return (
    <>
      <Topbar app={false} />
      <main className="stack" style={{ maxWidth: 1400 }}>
        <h1 style={{ fontSize: 'var(--s-30)' }}>{t('nav.console')}</h1>
        <section className="grid three">
          {(['bank', 'regulator', 'operator'] as const).map((r) => <RolePanel key={r} role={r} selected={selected} onDone={() => void agents.reload()} />)}
        </section>
        <section className="panel" style={{ maxHeight: 520, overflow: 'auto' }} aria-label="Agents">
          <table>
            <thead><tr><th>Account</th><th>Status</th><th>KYA</th><th>Jurisdiction</th><th /></tr></thead>
            <tbody>
              {agents.data?.agents.map((a) => (
                <tr key={a.account} aria-selected={selected === a.account}>
                  <td className="mono">{a.account}</td>
                  <td><span className={`pill ${PILL[a.status]}`}>{a.status}</span></td>
                  <td>level {a.kycLevel}, {a.riskProfile}</td>
                  <td>{a.jurisdiction}</td>
                  <td><button onClick={() => setSelected(a.account)}>{selected === a.account ? 'Selected' : 'Select'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </main>
    </>
  );
}
