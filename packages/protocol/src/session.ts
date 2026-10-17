// Node only: imported as @praetor/protocol/session. The user's web session (spec 05): the api sets it after a passkey
// login, mcp's OAuth consent reads it. Stateless `account.expiresAt.mac` (from BSA Sentry apps/server/src/auth.ts), so
// a restart logs nobody out; SESSION_SECRET is shared by the api and mcp only.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'praetor_session';
export const SESSION_TTL_S = 12 * 3600;

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signSession(account: string, secret: string, now = () => Math.floor(Date.now() / 1000)): string {
  const body = `${account.toLowerCase()}.${now() + SESSION_TTL_S}`;
  return `${body}.${hmac(secret, body)}`;
}

export function readSession(req: { headers: { cookie?: string } }, secret: string, now = () => Math.floor(Date.now() / 1000)): string | null {
  const raw = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const parts = decodeURIComponent(raw).split('.');
  if (parts.length !== 3) return null;
  const [account, exp, mac] = parts as [string, string, string];
  const a = Buffer.from(mac);
  const b = Buffer.from(hmac(secret, `${account}.${exp}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) <= now()) return null;
  return account;
}
