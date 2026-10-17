// OAuth 2.1 authorization server for the MCP resource (spec 05), ported from BSA Sentry apps/server/src/oauth.ts
// (docs/PREEXISTING.md), shaped by what claude.ai sends: metadata discovery, dynamic client registration with
// client_secret_post, authorization code + PKCE S256 + RFC 8707 `resource`, refresh. A token lets an external agent
// use the Praetor tools of one account (inside its on-chain mandate), nothing else, and the user can revoke it.
// Nothing auto-approves: /authorize needs a Praetor session (set by the api) and an explicit consent with a CSRF token.
// Secrets, codes and tokens are stored as SHA-256 hashes only.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { readSession } from '@praetor/protocol/session';
import type { Client, OAuthStore } from './oauth-store.js';

export const SCOPE = 'praetor:agent';
const CODE_TTL_S = 600;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;

export type OAuthOptions = {
  store: OAuthStore;
  /** Public base URL of this server, e.g. the tunnel or the deployed host. */
  baseUrl: string;
  /** The web app, where the user signs in with a passkey. */
  webOrigin: string;
  secret: string;
  now?: () => number;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function validRedirect(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false;
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** Async route handlers: a rejected promise goes to Express' error handler. */
const a = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function oauthRouter(opts: OAuthOptions) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const base = opts.baseUrl.replace(/\/$/, '');
  const resource = `${base}/mcp`;
  const store = opts.store;
  const router = Router();
  const body = [json({ limit: '16kb' }), urlencoded({ extended: false, limit: '16kb' })];

  // ------------------------------------------------------------------ discovery

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      scopes_supported: [SCOPE],
    });
  });

  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => {
    res.json({ resource, authorization_servers: [base], scopes_supported: [SCOPE], bearer_methods_supported: ['header'] });
  });

  // ------------------------------------------------------------------ registration (RFC 7591)

  router.post('/oauth/register', ...body, a(async (req, res) => {
    const uris = req.body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every(validRedirect)) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'https redirect URIs are required (localhost excepted)' });
    }
    const method = req.body.token_endpoint_auth_method === 'none' ? 'none' : 'client_secret_post';
    const clientId = `praetor_${randomBytes(12).toString('hex')}`;
    const secret = method === 'none' ? undefined : randomBytes(32).toString('base64url');
    const name = typeof req.body.client_name === 'string' ? req.body.client_name.slice(0, 64) : null;
    await store.addClient({ client_id: clientId, client_secret_hash: secret ? sha256(secret) : null, client_name: name, redirect_uris: JSON.stringify(uris) });
    res.status(201).json({
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: now(),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  }));

  const client = async (id: unknown): Promise<Client | undefined> => (typeof id === 'string' ? store.getClient(id) : undefined);

  // ------------------------------------------------------------------ authorize

  /** Validates the request before anything is shown or redirected. */
  async function checkAuthorize(q: Record<string, unknown>): Promise<{ c: Client; redirect: string } | string> {
    const c = await client(q.client_id);
    if (!c) return 'unknown client';
    const redirect = String(q.redirect_uri ?? '');
    if (!(JSON.parse(c.redirect_uris) as string[]).includes(redirect)) return 'redirect_uri is not registered for this client';
    if (q.response_type !== 'code') return 'only response_type=code is supported';
    if (typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return 'a PKCE code_challenge is required';
    if (q.code_challenge_method !== 'S256') return 'only PKCE S256 is supported';
    if (q.resource !== undefined && q.resource !== resource) return 'unknown resource';
    return { c, redirect };
  }

  /** Ties the consent form to this account and this exact request. */
  const csrfFor = (account: string, query: string) => createHmac('sha256', opts.secret).update(`csrf|${account}|${query}`).digest('base64url');

  router.get('/oauth/authorize', a(async (req, res) => {
    const check = await checkAuthorize(req.query as Record<string, unknown>);
    // An invalid client or redirect is shown here, never redirected to (RFC 6749 §4.1.2.1).
    if (typeof check === 'string') return res.status(400).type('html').send(page('Invalid request', `<p>${esc(check)}</p>`));

    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const account = readSession(req, opts.secret, now);
    if (!account) {
      const back = encodeURIComponent(`${base}/oauth/authorize?${query}`);
      return res.type('html').send(page('Sign-in required', `
        <p>To authorize <b>${esc(check.c.client_name ?? 'this agent')}</b>, sign in to Praetor with your passkey first.</p>
        <p><a class="btn" href="${esc(opts.webOrigin)}/login?returnTo=${back}">Sign in to Praetor</a></p>`));
    }

    res.type('html').send(page('Authorize this agent?', `
      <h1>Allow ${esc(check.c.client_name ?? 'this agent')} to use your Praetor agent tools?</h1>
      <p>Account <code>${esc(account)}</code></p>
      <ul>
        <li>${esc(check.c.client_name ?? 'The agent')} will see your portfolio and mandate and can ask for payments and rebalancing.</li>
        <li><b>Your mandate decides on-chain</b>: what fits it is done, what needs you waits for your approval, the rest is refused.</li>
        <li>You can revoke this access at any time from Settings.</li>
      </ul>
      <form method="post" action="/oauth/authorize?${esc(query)}">
        <input type="hidden" name="csrf" value="${esc(csrfFor(account, query))}">
        <button name="decision" value="allow" class="btn">Allow ${esc(check.c.client_name ?? 'this agent')} to use your Praetor agent tools</button>
        <button name="decision" value="deny" class="btn secondary">Deny</button>
      </form>`));
  }));

  router.post('/oauth/authorize', ...body, a(async (req, res) => {
    const check = await checkAuthorize(req.query as Record<string, unknown>);
    if (typeof check === 'string') return res.status(400).type('html').send(page('Invalid request', `<p>${esc(check)}</p>`));
    const account = readSession(req, opts.secret, now);
    if (!account) return res.status(401).type('html').send(page('Login required', '<p>Session expired.</p>'));
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const csrf = typeof req.body?.csrf === 'string' ? req.body.csrf : '';
    if (!sameSecret(csrf, csrfFor(account, query))) return res.status(403).type('html').send(page('Denied', '<p>Invalid form token.</p>'));

    const back = new URL(check.redirect);
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (state) back.searchParams.set('state', state);
    if (req.body.decision !== 'allow') {
      back.searchParams.set('error', 'access_denied');
      return res.redirect(302, back.toString());
    }
    const code = token('code');
    await store.addCode({ code_hash: sha256(code), client_id: check.c.client_id, account, redirect_uri: check.redirect, code_challenge: String(req.query.code_challenge), scope: SCOPE, expires_at: now() + CODE_TTL_S });
    back.searchParams.set('code', code);
    res.redirect(302, back.toString());
  }));

  // ------------------------------------------------------------------ token

  async function authenticateClient(b: Record<string, unknown>): Promise<Client | null> {
    const c = await client(b.client_id);
    if (!c) return null;
    if (!c.client_secret_hash) return c; // public PKCE client
    const secret = typeof b.client_secret === 'string' ? b.client_secret : '';
    return sameSecret(sha256(secret), c.client_secret_hash) ? c : null;
  }

  async function issue(clientId: string, account: string, family: string) {
    const access = token('at');
    const refresh = token('rt');
    await store.addToken({ token_hash: sha256(access), kind: 'access', client_id: clientId, account, scope: SCOPE, family, created_at: now(), expires_at: now() + ACCESS_TTL_S });
    await store.addToken({ token_hash: sha256(refresh), kind: 'refresh', client_id: clientId, account, scope: SCOPE, family, created_at: now(), expires_at: now() + REFRESH_TTL_S });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
  }

  const revokeFamily = (family: string) => store.revokeFamily(family);

  router.post('/oauth/token', ...body, a(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const c = await authenticateClient(b);
    if (!c) return res.status(401).json({ error: 'invalid_client' });
    const grant = (desc: string) => res.status(400).json({ error: 'invalid_grant', error_description: desc });

    if (b.grant_type === 'authorization_code') {
      const row = await store.getCode(sha256(String(b.code ?? '')));
      if (!row || row.client_id !== c.client_id) return grant('unknown code');
      if (row.used) {
        // RFC 6749 §4.1.2: a replayed code revokes what it produced.
        await revokeFamily(row.code_hash);
        return grant('code already used');
      }
      await store.markCodeUsed(row.code_hash);
      if (row.expires_at <= now()) return grant('code expired');
      if (b.redirect_uri !== row.redirect_uri) return grant('redirect_uri mismatch');
      const verifier = typeof b.code_verifier === 'string' ? b.code_verifier : '';
      const computed = createHash('sha256').update(verifier).digest('base64url');
      if (!verifier || !sameSecret(computed, row.code_challenge)) return grant('PKCE verification failed');
      // The token family is keyed by the code, so a replay of this code can find it.
      return res.json(await issue(c.client_id, row.account, row.code_hash));
    }

    if (b.grant_type === 'refresh_token') {
      const found = await store.getToken(sha256(String(b.refresh_token ?? '')));
      const row = found?.kind === 'refresh' ? found : undefined;
      if (!row || row.client_id !== c.client_id) return grant('unknown refresh token');
      if (row.revoked) {
        // A rotated-out refresh token came back: assume it was stolen, kill the family.
        await revokeFamily(row.family);
        return grant('refresh token reused');
      }
      if (row.expires_at <= now()) return grant('refresh token expired');
      // Rotation: the old refresh token and every live access token of the family go.
      await revokeFamily(row.family);
      return res.json(await issue(c.client_id, row.account, row.family));
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  }));

  // ------------------------------------------------------------------ revocation

  router.post('/oauth/revoke', ...body, a(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!(await authenticateClient(b))) return res.status(401).json({ error: 'invalid_client' });
    const row = await store.getToken(sha256(String(b.token ?? '')));
    if (row) await revokeFamily(row.family);
    res.status(200).json({}); // RFC 7009: same answer whether or not the token existed
  }));

  /** The dashboard's view: one entry per grant (token family), no token material. */
  router.get('/oauth/grants', a(async (req, res) => {
    const account = readSession(req, opts.secret, now);
    if (!account) return res.status(401).json({ error: 'not logged in' });
    res.json({ grants: await store.grants(account, now()) });
  }));

  router.post('/oauth/grants/:id/revoke', a(async (req, res) => {
    const account = readSession(req, opts.secret, now);
    if (!account) return res.status(401).json({ error: 'not logged in' });
    if (!(await store.ownsFamily(String(req.params.id), account))) return res.status(404).json({ error: 'no such grant' });
    await revokeFamily(String(req.params.id));
    res.json({ ok: true });
  }));

  return router;
}

/** Bearer middleware for /mcp. Sets `req.account`; 401 with the resource metadata otherwise. */
export function requireBearer(opts: { store: OAuthStore; baseUrl: string; now?: () => number }) {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const meta = `${opts.baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`;
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const raw = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const row = raw ? await opts.store.getToken(sha256(raw)) : undefined;
      if (!row || row.kind !== 'access' || row.revoked || row.expires_at <= now() || row.scope !== SCOPE) {
        return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${meta}"`).json({ error: 'unauthorized' });
      }
      (req as Request & { account: string }).account = row.account;
      next();
    })().catch(next);
  };
}

function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)} · Praetor</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#111}
  h1{font-size:22px} code{background:#f2f2f2;padding:2px 6px;border-radius:4px;word-break:break-all}
  .btn{display:inline-block;margin:6px 8px 0 0;padding:12px 18px;border:0;border-radius:10px;background:#111;color:#fff;font-size:16px;cursor:pointer;text-decoration:none}
  .btn.secondary{background:#e8e8e8;color:#111} li{margin:6px 0}
</style></head><body><p><b>Praetor</b> · Your agent acts. Your mandate decides.</p>${content}</body></html>`;
}
