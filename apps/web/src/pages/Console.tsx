// Consortium console (spec 07): the agents' statuses (chain data), and one panel per member (bank, regulator,
// operator) side by side. Staff sign in with their member service's passkey; every consortium signature is that
// passkey over the attestation digest, checked by the member service (the api only relays). The tracker shows who
// signed and how many signatures the action needs.
import { useEffect, useState } from 'react';
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

type Opened = { board: string; proposalId: string; opener: Role };

/** One open proposal as a member sees it: who signed, how many it needs, and this member's passkey to sign it. */
function ProposalCard({ role, session, o, onSigned }: { role: Role; session: string; o: Opened; onSigned(): void }) {
  const [p, setP] = useState<Proposal>();
  const [msg, setMsg] = useState<string>();
  const refresh = () => call<Proposal>('GET', `/${role}/proposals/${o.board}/${o.proposalId}`, undefined, session).then(setP, (e: Error) => setMsg(e.message));
  useEffect(() => { void refresh(); const i = setInterval(() => void refresh(), 5000); return () => clearInterval(i); }, [o.board, o.proposalId, session]);
  if (!p) return msg ? <p className="small error">{msg}</p> : null;
  return (
    <div className="card stack" data-testid={`proposal-${role}-${o.board}-${o.proposalId}`}>
      <div className="row between">
        <span>{p.primaryType ?? o.board} #{o.proposalId} <span className="muted small">({o.opener})</span></span>
        <span className={`pill ${p.status === 2 ? 'ok' : 'wait'}`}>{p.signers.length} of 3 signed · needs {p.required} · {PROPOSAL_STATUS[p.status] ?? p.status}</span>
      </div>
      {p.status === 1 && (
        <button className="primary" onClick={async () => {
          setMsg(undefined);
          try {
            const r = await call<{ ready: boolean }>('POST', `/${role}/proposals/${o.board}/${o.proposalId}/sign`, { assertion: await staffAssert(p.digest, role) }, session);
            setMsg(r.ready ? 'Ready: the bridge delivers it to Base.' : 'Signed: waiting for another member.');
            await refresh();
            onSigned();
          } catch (e) { setMsg((e as Error).message); }
        }}>Sign with my passkey</button>
      )}
      <p className="small muted mono">digest {p.digest}</p>
      {msg && <p role="status" className="small">{msg}</p>}
    </div>
  );
}

function RolePanel({ role, selected, proposals, onOpened, onDone }: { role: Role; selected?: string; proposals: Opened[]; onOpened(o: Opened): void; onDone(): void }) {
  const [session, setSession] = useState<string | null>(() => sessionStorage.getItem(`praetor.staff.${role}`));
  const [label, setLabel] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [enrol, setEnrol] = useState<string>();
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('US');
  const run = (fn: () => Promise<void>) => async () => { setMsg(undefined); try { await fn(); } catch (e) { setMsg((e as Error).message); } };
  const openAction = (action: string, params: Record<string, unknown>) => run(async () => {
    const o = await call<{ board: string; proposalId: string }>('POST', `/${role}/open`, { action, params }, session!);
    onOpened({ ...o, opener: role });
  });

  return (
    <article className="panel stack" data-testid={`console-${role}`}>
      <div className="row between"><h2 style={{ textTransform: 'capitalize' }}>{role}</h2>{session && <span className="pill ok">{label ?? 'staff'}</span>}</div>
      {!session ? (
        <div className="stack">
          <button className="primary" onClick={run(async () => {
            const { challenge } = await call<{ challenge: `0x${string}` }>('POST', `/${role}/challenge`);
            const r = await call<{ session: string; label: string }>('POST', `/${role}/login`, { assertion: await staffAssert(challenge, role) });
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
          {proposals.map((o) => <ProposalCard key={`${o.board}-${o.proposalId}`} role={role} session={session} o={o} onSigned={onDone} />)}
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
  // Proposals opened from this console, shown in every member's panel: freeze needs one signature, loosen two.
  const [proposals, setProposals] = useState<Opened[]>([]);
  return (
    <>
      <Topbar app={false} />
      <main className="stack" style={{ maxWidth: 1400 }}>
        <h1 style={{ fontSize: 'var(--s-30)' }}>{t('nav.console')}</h1>
        <section className="grid three">
          {(['bank', 'regulator', 'operator'] as const).map((r) => <RolePanel key={r} role={r} selected={selected} proposals={proposals} onOpened={(o) => setProposals((l) => [o, ...l.filter((x) => x.board !== o.board || x.proposalId !== o.proposalId)])} onDone={() => void agents.reload()} />)}
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
