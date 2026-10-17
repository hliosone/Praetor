// Web sign-in (spec 05): passkeys through WebAuthn (@simplewebauthn/server, rpID = PUBLIC_HOST), a stateless
// httpOnly session cookie (shared format with mcp's OAuth consent), and a CSRF token bound to that session.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, SESSION_TTL_S, readSession, signSession } from '@praetor/protocol/session';

export const CSRF_COOKIE = 'praetor_csrf';

export function setSession(res: Response, account: string, secret: string, secure: boolean) {
  const value = signSession(account, secret);
  const csrf = createHmac('sha256', secret).update(`csrf|${value}`).digest('base64url');
  const flags = `Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_S}${secure ? '; Secure' : ''}`;
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; ${flags}`);
  res.append('Set-Cookie', `${CSRF_COOKIE}=${csrf}; ${flags}`);
}

export function clearSession(res: Response) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.append('Set-Cookie', `${CSRF_COOKIE}=; Path=/; Max-Age=0`);
}

const cookieValue = (req: Request, name: string) =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

/** Requires a session; on POST also the CSRF header derived from that very session. Sets res.locals.account. */
export function requireSession(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const account = readSession(req, secret);
    if (!account) return res.status(401).json({ error: 'not signed in' });
    if (req.method !== 'GET') {
      const raw = decodeURIComponent(cookieValue(req, SESSION_COOKIE) ?? '');
      const want = Buffer.from(createHmac('sha256', secret).update(`csrf|${raw}`).digest('base64url'));
      const got = Buffer.from(req.header('x-csrf-token') ?? '');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(403).json({ error: 'bad CSRF token' });
    }
    res.locals.account = account;
    next();
  };
}
