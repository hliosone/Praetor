// Production ports of the tools: Base reads (free views), submission through agent-signer and the bundler, approval
// requests to the api, payee names from mcp's database.
import type { Address, Hex, PublicClient } from 'viem';
import { accountReader, type Deployment } from '@praetor/chain';
import { signCaller } from '@praetor/protocol/caller-auth';
import { ENTRY_POINT, encodeExecute } from '@praetor/userop';
import type { SqlRunner } from '@praetor/db';
import type { Call, Ports, Submission } from './tools.js';

/** Base reads of the account: the shared reader of @praetor/chain. */
export function chainReader(pub: PublicClient, d: Deployment): Ports['reader'] {
  return accountReader(pub, d);
}

export type SubmitConfig = {
  bundlerUrl: string; bundlerToken: string; signerUrl: string; signerSecret: string;
  /** The account's agent key on Base: the signer signs with the version that has this address (F10 rotations). */
  agentKeyOf(account: Address): Promise<Address>;
};

/** prepare (bundler) -> sign (agent-signer, mcp is its only sign-userop caller) -> send (bundler). */
export function submitter(c: SubmitConfig): Ports['submit'] {
  const bundler = async (path: string, body: unknown) => {
    const r = await fetch(`${c.bundlerUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.bundlerToken}` }, body: json(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status >= 300) throw new Error(`bundler ${path}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j as Record<string, any>;
  };
  return async (account: Address, calls: Call[]): Promise<Submission> => {
    const p = await bundler('/userop/prepare', { sender: account, callData: encodeExecute(calls), validator: 'agent' });
    const path = `/v1/agents/${account}/sign-userop`;
    const body = json({ userOp: p.userOp, chainId: 84532, entryPoint: ENTRY_POINT, agentKey: await c.agentKeyOf(account) });
    const r = await fetch(`${c.signerUrl}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...signCaller('mcp', c.signerSecret, 'POST', path, Buffer.from(body)) } });
    const sig = (await r.json().catch(() => ({}))) as { signature?: Hex; error?: string };
    if (!r.ok || !sig.signature) throw new Error(`agent-signer: ${r.status} ${sig.error ?? ''}`);
    const s = await bundler('/userop/send', { userOp: { ...p.userOp, signature: sig.signature } });
    return { userOpHash: s.userOpHash, txHash: s.txHash ?? null, success: s.success === true, reasons: (s.reasons ?? []).map(Number), refusalLogTx: s.refusalLogTx ?? null };
  };
}

/** Approval requests live in the api (M9); without it they are refused plainly. */
/** The agent's standing-order proposals, stored in the api as owner requests (F7 step 1). */
export function apiProposals(apiUrl: string | undefined, token: string | undefined): Ports['proposals'] {
  return {
    standingOrder: async (req) => {
      if (!apiUrl || !token) throw new Error('the owner request service is not available');
      const r = await fetch(`${apiUrl}/internal/standing-order-proposals`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: json(req) });
      if (!r.ok) throw new Error(`api standing-order proposal: ${r.status}`);
      return r.json() as Promise<{ id: string }>;
    },
  };
}

export function apiApprovals(apiUrl: string | undefined, token: string | undefined): Ports['approvals'] {
  const call = async (method: string, path: string, body?: unknown) => {
    if (!apiUrl || !token) throw new Error('the approval service is not available');
    const r = await fetch(`${apiUrl}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : json(body) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`api ${path}: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  return {
    request: async (req) => (await call('POST', '/internal/approvals', req)) as { id: string },
    get: (account, id) => call('GET', `/internal/approvals/${encodeURIComponent(id)}?account=${account}`),
  };
}

export function dbLabels(r: SqlRunner): Ports['labels'] {
  return async (account) => {
    const rows = (await r.query('SELECT address, label FROM payee_labels WHERE account = ?', [account.toLowerCase()])) as { address: string; label: string }[];
    return Object.fromEntries(rows.map((x) => [x.address.toLowerCase(), x.label]));
  };
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
