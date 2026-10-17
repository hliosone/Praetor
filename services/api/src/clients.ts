// The api's calls to the internal services (Docker network): bundler and member services (bearer tokens),
// agent-signer and soter-attester (caller HMAC, the api is one of their callers), agent-runner, mcp.
import type { Address, Hex } from 'viem';
import { signCaller } from '@praetor/protocol/caller-auth';

export class UpstreamError extends Error {
  constructor(readonly service: string, readonly status: number, readonly body: unknown) {
    super(`${service}: ${status}`);
  }
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

async function call(service: string, url: string, init: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(120_000) });
  const body = await r.json().catch(() => null);
  if (r.status >= 300) throw new UpstreamError(service, r.status, body);
  return body;
}

export type ClientConfig = {
  bundlerUrl: string; bundlerToken: string;
  bankUrl: string; membersToken: string;
  signerUrl: string; signerSecret: string;
  attesterUrl: string; attesterSecret: string;
  runnerUrl: string; runnerToken: string;
  mcpUrl: string; mcpToken: string;
};

export function clients(c: ClientConfig) {
  const bearer = (token: string) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
  const post = (service: string, base: string, token: string) => (path: string, body?: unknown) =>
    call(service, `${base}${path}`, { method: 'POST', headers: bearer(token), body: body === undefined ? undefined : json(body) });
  const get = (service: string, base: string, token: string) => (path: string) => call(service, `${base}${path}`, { headers: bearer(token) });
  const hmac = (service: string, base: string, secret: string) => (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const raw = body === undefined ? '' : json(body);
    return call(service, `${base}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller('api', secret, method, path, Buffer.from(raw)) } });
  };
  const bundlerPost = post('bundler', c.bundlerUrl, c.bundlerToken);
  const bankPost = post('bank', c.bankUrl, c.membersToken);
  const bankGet = get('bank', c.bankUrl, c.membersToken);
  const signer = hmac('agent-signer', c.signerUrl, c.signerSecret);
  const attester = hmac('soter-attester', c.attesterUrl, c.attesterSecret);
  return {
    bundler: {
      register: (address: Address) => bundlerPost('/accounts', { address }),
      prepare: (b: Record<string, unknown>) => bundlerPost('/userop/prepare', b) as Promise<{ userOp: Record<string, unknown>; userOpHash: Hex }>,
      send: (userOp: Record<string, unknown>) => bundlerPost('/userop/send', { userOp }) as Promise<{ userOpHash: Hex; txHash: Hex | null; success: boolean; reasons: number[]; refusalLogTx: Hex | null }>,
      tx: (to: Address, data: Hex) => bundlerPost('/tx', { to, data }) as Promise<{ txHash: Hex | null; success: boolean; revert?: string }>,
    },
    bank: {
      kycStart: (userRef: string, account: Address, method: 'vendor' | 'eudi') => bankPost('/kyc/sessions', { userRef, account, method }),
      kycStatus: (userRef: string) => bankGet(`/kyc/status/${encodeURIComponent(userRef)}`),
      kycSession: (id: string) => bankGet(`/kyc/sessions/${encodeURIComponent(id)}`),
      suitability: (userRef: string, answers: number[]) => bankPost('/suitability', { userRef, answers }),
      kyaNonce: (account: Address) => bankPost('/kya/nonce', { account }) as Promise<{ nonce: Hex }>,
      kyaVerify: (b: { account: Address; agentKey: Address; quote: string; nonce: Hex }) => bankPost('/kya/verify', b) as Promise<{ agentKey: Address; measurement: Hex }>,
      agentDid: (account: Address, keyVersion = 1) => bankPost('/kya/agent-did', { account, keyVersion }) as Promise<{ agentWeId: string; agentDidHash: Hex }>,
      revokeMandates: (account: Address) => bankPost('/kya/mandate/revoke', { account }) as Promise<{ revoked: string[] }>,
      mandatePrepare: (b: { userRef: string; account: Address; agentKey: Address; scopes: string[]; mandateHash: Hex }) => bankPost('/kya/mandate/prepare', b) as Promise<{ draftId: string; challenge: Hex; claim: Record<string, unknown> }>,
      mandateSign: (draftId: string, assertion: unknown) => bankPost('/kya/mandate/sign', { draftId, assertion }) as Promise<{ mandateCredentialHash: Hex }>,
      kya: (b: { account: Address; agentDidHash: Hex; validUntil: bigint }) => bankPost('/kya', b),
      policyCheck: (account: Address, policy: Hex) => bankPost('/policy/check', { account, policy }) as Promise<{ ok: boolean; failedRule: number; fiscoRef: Hex }>,
      cosign: (ownerAction: unknown, payload: Hex) => bankPost('/owner-actions/cosign', { ownerAction, payload }) as Promise<{ bankSig: Hex; digest: Hex }>,
    },
    signer: {
      address: (account: Address, keyVersion = 1) => signer('GET', `/v1/agents/${account}/address?v=${keyVersion}`) as Promise<{ address: Address }>,
      attest: (account: Address, nonce: Hex, keyVersion = 1) => signer('POST', `/v1/agents/${account}/attest`, { nonce, keyVersion }) as Promise<{ address: Address; quote: string }>,
      info: () => signer('GET', '/v1/info') as Promise<{ simulator: boolean; composeHash: string }>,
    },
    attester: {
      approve: (b: Record<string, unknown>) => attester('POST', '/v1/soter/approve', b) as Promise<{ soterApproval: Record<string, string>; attesterSig: Hex }>,
    },
    runner: {
      chat: (account: Address, message: string) => fetch(`${c.runnerUrl}/chat`, { method: 'POST', headers: bearer(c.runnerToken), body: json({ account, message }) }),
    },
    mcp: {
      setLabels: (account: Address, labels: { address: Address; label: string }[]) =>
        fetch(`${c.mcpUrl}/internal/payee-labels`, { method: 'PUT', headers: bearer(c.mcpToken), body: json({ account, labels }) }),
    },
  };
}

export type Clients = ReturnType<typeof clients>;
