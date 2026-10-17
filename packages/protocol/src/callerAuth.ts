// Node only (node:crypto): imported as @praetor/protocol/caller-auth so the package root stays browser-safe.
// Service-to-service caller authentication (spec 05: "HMAC per caller"): the caller names itself and signs the
// timestamp, method, path and exact body with its own secret. Used by agent-signer and soter-attester.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type CallerHeaders = { 'x-praetor-caller': string; 'x-praetor-ts': string; 'x-praetor-signature': string };

const WINDOW_S = 60;
const mac = (secret: string, ts: string, method: string, path: string, body: Uint8Array) =>
  `sha256=${createHmac('sha256', secret).update(`${ts}\n${method.toUpperCase()}\n${path}\n`).update(body).digest('hex')}`;

export function signCaller(caller: string, secret: string, method: string, path: string, body: Uint8Array, now = Math.floor(Date.now() / 1000)): CallerHeaders {
  const ts = String(now);
  return { 'x-praetor-caller': caller, 'x-praetor-ts': ts, 'x-praetor-signature': mac(secret, ts, method, path, body) };
}

/** The authenticated caller name, or null. `secrets` maps each allowed caller to its secret. */
export function verifyCaller(headers: Partial<Record<string, string | undefined>>, secrets: Record<string, string>, method: string, path: string, body: Uint8Array, now = Math.floor(Date.now() / 1000)): string | null {
  const caller = headers['x-praetor-caller'];
  const ts = headers['x-praetor-ts'];
  const sig = headers['x-praetor-signature'];
  if (!caller || !ts || !sig || !/^\d{1,12}$/.test(ts)) return null;
  const secret = Object.prototype.hasOwnProperty.call(secrets, caller) ? secrets[caller] : undefined;
  if (!secret || Math.abs(now - Number(ts)) > WINDOW_S) return null;
  const want = Buffer.from(mac(secret, ts, method, path, body));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) ? caller : null;
}

/** Remembers signatures for the validity window so a captured request cannot be replayed. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  once(signature: string, now = Math.floor(Date.now() / 1000)): boolean {
    for (const [s, t] of this.seen) if (now - t > 2 * WINDOW_S) this.seen.delete(s);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, now);
    return true;
  }
}
