// The api, same origin (Caddy routes /api): the session cookie travels by itself, writes carry the CSRF token
// readable from its cookie. Amounts arrive as decimal strings (6 decimals for USD values).
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('praetor_csrf='))?.slice('praetor_csrf='.length);

export async function api<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = csrf();
  if (method !== 'GET' && token) headers['x-csrf-token'] = token;
  const r = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data);
  return data as T;
}

export type Me = { userId: string; email: string; account: `0x${string}` };
export type Asset = { symbol: 'USDC' | 'tXAU' | 'tXAG'; token: string; balance: string; valueUsd6: string; weightBps: number; band: { minBps: number; targetBps: number; maxBps: number } | null; demoPrice: boolean };
export type Portfolio = { totalUsd6: string; assets: Asset[] };
export type Status = { effective: 'ACTIVE' | 'RESTRICTED' | 'FROZEN'; heartbeatValidUntil: string; now: string };
export type Activity = { kind: 'decision' | 'refusal'; reason: string; tier: string; target: string; txHash: string; valueUsd6?: string };
export type ApprovalView = {
  id: string; state: string; reason: string; summary: string; digest: `0x${string}`; soterChallenge: string;
  calls: { to: `0x${string}`; value: string; data: `0x${string}` }[];
  tier2: { account: `0x${string}`; callHash: `0x${string}`; nonce: string; expiresAt: string };
};
export type Prepared = { ownerAction: unknown; payload: `0x${string}`; digest: `0x${string}` };

/** usd6 decimal string -> "1,234.56" */
export function usd(v6: string | bigint | undefined): string {
  const n = Number(BigInt(v6 ?? 0)) / 1e6;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
