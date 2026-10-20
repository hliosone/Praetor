// api (spec 05): the backend of the web app, the mini program and the consoles. Untrusted for safety: it prepares,
// relays and displays; every authority check is on-chain or in a member service.
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { ApiStore } from './store.js';
import { clearSession, requireSession, setSession } from './auth.js';
import { UpstreamError } from './clients.js';

export type ApiDeps = {
  store: ApiStore;
  sessionSecret: string;
  rpId: string;
  origin: string;
  /** The counterfactual Safe7579 account of a passkey (packages/userop prepareAccount). */
  accountFor(p: { credIdHash: Hex; x: bigint; y: bigint }, saltNonce: bigint): Promise<{ address: Address }>;
  /** Whether Base holds this passkey as an owner key of the account: only those sign in (a new device after its
   *  SET_OWNER_KEY, a recovered one after executeRecovery). */
  isOwnerKey?(account: Address, credIdHash: Hex): Promise<boolean>;
  /** F10 recovery: the bank's re-KYC with the new passkey, the hook's recovery state, executeRecovery after 48 h. */
  recovery?: {
    start(userRef: string, account: Address, key: { credIdHash: Hex; x: Hex; y: Hex }): Promise<{ redirectUrl: string }>;
    status(account: Address): Promise<unknown>;
    execute(account: Address): Promise<unknown>;
  };
  /** Requests per minute per client address on the public sign-in, onboarding and recovery routes (default 60). */
  rateLimitPerMinute?: number;
  extend?: (r: express.Router, h: typeof handler, session: ReturnType<typeof requireSession>) => void;
  /** Routers outside /api (the mini program's /mp, the internal routes for mcp). */
  mount?: (app: express.Express, h: typeof handler) => void;
};

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const handler = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const CHALLENGE_TTL_MS = 5 * 60_000;

export function createApiApp(d: ApiDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  // Caddy, on the internal network, is the only client: the address that matters is the one it forwards.
  app.set('trust proxy', 'uniquelocal');
  // A write from another site is refused before anything runs; the CSRF token is the second lock (spec 08).
  const ownOrigin = new URL(d.origin).origin;
  app.use('/api', (req, res, next) => {
    const o = req.header('origin');
    if (req.method !== 'GET' && req.method !== 'HEAD' && o && o !== ownOrigin) return res.status(403).json({ error: 'cross-origin request refused' });
    next();
  });
  const hits = new Map<string, { n: number; until: number }>();
  const limited = (group: string): express.RequestHandler => (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    const key = `${group}:${req.ip}`;
    let w = hits.get(key);
    if (!w || w.until < now) hits.set(key, (w = { n: 0, until: now + 60_000 }));
    if (++w.n > (d.rateLimitPerMinute ?? 60)) return res.status(429).json({ error: 'too many requests' });
    next();
  };
  app.use('/api/auth', limited('auth'));
  app.use(['/api/onboarding/start', '/api/onboarding/passkey'], limited('onboarding'));
  app.use('/api/recover', limited('recover'));
  // The demo x402 merchant: each payment proof costs Base RPC reads (D107).
  app.use('/api/x402', limited('x402'));
  // Each mini program sign-in reaches WeChat's code2Session.
  app.use('/mp/session', limited('mp'));
  const secure = d.origin.startsWith('https:');
  const challenges = new Map<string, { challenge: string; at: number }>();
  const takeChallenge = (key: string) => {
    const c = challenges.get(key);
    challenges.delete(key);
    return c && Date.now() - c.at < CHALLENGE_TTL_MS ? c.challenge : undefined;
  };
  const session = requireSession(d.sessionSecret);
  const h = handler;
  const r = express.Router();

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  r.post('/onboarding/start', h(async (req, res) => {
    const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
    res.json({ userId: (await d.store.createUser(email)).id });
  }));

  r.post('/onboarding/passkey/options', h(async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    const u = await d.store.getUser(userId);
    if (!u) throw new HttpError(404, 'unknown user');
    // A second passkey is added through an owner action (SET_OWNER_KEY), not here.
    if ((await d.store.passkeysOf(userId)).length > 0) throw new HttpError(409, 'this user already has a passkey');
    const options = await generateRegistrationOptions({
      rpName: 'Praetor', rpID: d.rpId, userName: u.email, attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, supportedAlgorithmIDs: [-7],
    });
    challenges.set(`reg:${userId}:${options.challenge}`, { challenge: options.challenge, at: Date.now() });
    res.json(options);
  }));

  // `exclude`: the user's passkeys, so a device does not register twice. Only for a signed-in owner: a recovery is asked
  // for by email alone, and a credential id leads to the account on Base (keccak256 is the OwnerKeySet topic).
  const registrationOptions = async (userId: string, key: string, userName: string, exclude: boolean) => {
    const options = await generateRegistrationOptions({
      rpName: 'Praetor', rpID: d.rpId, userName, attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, supportedAlgorithmIDs: [-7],
      excludeCredentials: exclude ? (await d.store.passkeysOf(userId)).map((p) => ({ id: p.credentialId })) : [],
    });
    challenges.set(`${key}:${options.challenge}`, { challenge: options.challenge, at: Date.now() });
    return options;
  };
  // Pending registrations are keyed by their challenge too: a second request (anyone can ask for a recovery by email)
  // never cancels the first one.
  const challengeOf = (response: unknown) => {
    try {
      const cd = (response as { response?: { clientDataJSON?: unknown } } | undefined)?.response?.clientDataJSON;
      return String((JSON.parse(Buffer.from(String(cd), 'base64url').toString('utf8')) as { challenge?: unknown }).challenge ?? '');
    } catch {
      return '';
    }
  };
  /** Verifies a registration against the pending challenge: the passkey to store for the user. */
  const verifyRegistration = async (userId: string, key: string, response: unknown) => {
    const expectedChallenge = takeChallenge(`${key}:${challengeOf(response)}`);
    if (!expectedChallenge) throw new HttpError(400, 'no pending registration');
    let info;
    try {
      const v = await verifyRegistrationResponse({ response: response as never, expectedChallenge, expectedOrigin: d.origin, expectedRPID: d.rpId, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) throw new Error('not verified');
      info = v.registrationInfo;
    } catch {
      throw new HttpError(400, 'passkey registration refused');
    }
    const { x, y } = coseP256(info.credential.publicKey);
    const credIdHash = keccak256(toHex(Buffer.from(info.credential.id, 'base64url')));
    return { credentialId: info.credential.id, userId, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter, credIdHash, x, y };
  };
  const savePasskey = async (p: Awaited<ReturnType<typeof verifyRegistration>>) => {
    await d.store.addPasskey({ ...p, x: p.x.toString(), y: p.y.toString() });
    return { credIdHash: p.credIdHash, x: p.x, y: p.y };
  };
  /** Verifies a registration against the pending challenge and stores the passkey for the user. */
  const register = async (userId: string, key: string, response: unknown) => savePasskey(await verifyRegistration(userId, key, response));
  const keyJson = (k: { credIdHash: Hex; x: bigint; y: bigint }) => ({ credIdHash: k.credIdHash, x: `0x${k.x.toString(16)}` as Hex, y: `0x${k.y.toString(16)}` as Hex });

  r.post('/onboarding/passkey/verify', h(async (req, res) => {
    const b = z.object({ userId: z.string().uuid(), response: z.any() }).parse(req.body);
    const { credIdHash, x, y } = await register(b.userId, `reg:${b.userId}`, b.response);
    const saltNonce = BigInt(keccak256(toHex(`praetor-account:${b.userId}`))) % 2n ** 64n;
    const { address } = await d.accountFor({ credIdHash, x, y }, saltNonce);
    await d.store.setAccount(b.userId, address, saltNonce);
    setSession(res, address, d.sessionSecret, secure);
    res.json({ account: address, credIdHash });
  }));

  r.post('/auth/options', h(async (_req, res) => {
    const options = await generateAuthenticationOptions({ rpID: d.rpId, userVerification: 'required' });
    challenges.set(`auth:${options.challenge}`, { challenge: options.challenge, at: Date.now() });
    res.json(options);
  }));

  r.post('/auth/verify', h(async (req, res) => {
    const { response } = z.object({ response: z.object({ id: z.string(), response: z.object({ clientDataJSON: z.string() }).passthrough() }).passthrough() }).parse(req.body);
    const cd = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')) as { challenge?: string };
    const expectedChallenge = takeChallenge(`auth:${cd.challenge ?? ''}`);
    const pk = await d.store.passkey(response.id);
    if (!expectedChallenge || !pk) throw new HttpError(401, 'sign-in refused');
    const v = await verifyAuthenticationResponse({
      response: response as never, expectedChallenge, expectedOrigin: d.origin, expectedRPID: d.rpId, requireUserVerification: true,
      credential: { id: pk.credentialId, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter },
    }).catch(() => ({ verified: false, authenticationInfo: undefined }));
    if (!v.verified) throw new HttpError(401, 'sign-in refused');
    const u = await d.store.getUser(pk.userId);
    if (!u?.account) throw new HttpError(401, 'no account');
    if (d.isOwnerKey && !(await d.isOwnerKey(u.account as Address, pk.credIdHash as Hex))) throw new HttpError(401, 'this passkey is not an owner key of the account yet');
    if (v.authenticationInfo) await d.store.setCounter(pk.credentialId, v.authenticationInfo.newCounter);
    setSession(res, u.account, d.sessionSecret, secure);
    res.json({ account: u.account });
  }));

  r.post('/auth/logout', session, (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  // Devices (spec 07 settings, up to 4 passkeys): registered here, added on Base by SET_OWNER_KEY signed by a current one.
  const MAX_PASSKEYS = 4;
  const me = async (res: Response) => {
    const u = await d.store.userByAccount(res.locals.account);
    if (!u) throw new HttpError(401, 'unknown account');
    return u;
  };
  r.get('/passkeys', session, h(async (_req, res) => {
    const u = await me(res);
    const list = await d.store.passkeysOf(u.id);
    res.json({ passkeys: await Promise.all(list.map(async (p) => ({ credIdHash: p.credIdHash, active: d.isOwnerKey ? await d.isOwnerKey(u.account as Address, p.credIdHash as Hex) : true }))) });
  }));
  r.post('/passkeys/options', session, h(async (_req, res) => {
    const u = await me(res);
    // The limit is Base's: stored passkeys that never became owner keys (a stranger's recovery attempt) do not count.
    const list = await d.store.passkeysOf(u.id);
    const held = d.isOwnerKey ? (await Promise.all(list.map((p) => d.isOwnerKey!(u.account as Address, p.credIdHash as Hex)))).filter(Boolean).length : list.length;
    if (held >= MAX_PASSKEYS) throw new HttpError(409, `at most ${MAX_PASSKEYS} passkeys`);
    res.json(await registrationOptions(u.id, `device:${u.id}`, u.email, true));
  }));
  r.post('/passkeys/verify', session, h(async (req, res) => {
    const u = await me(res);
    res.json(keyJson(await register(u.id, `device:${u.id}`, z.object({ response: z.any() }).parse(req.body).response)));
  }));

  // Recovery (F10 step 6) for a user who lost every passkey: a new passkey for the email's account, then the bank's
  // own re-KYC; the hook replaces the keys 48 h later unless a remaining passkey cancels. No session: nothing here
  // grants access before Base holds the new key, and the passkey is stored only once the bank started its re-KYC.
  const recovering = async (userId: string) => {
    const u = await d.store.getUser(userId);
    if (!u?.account || !d.recovery) throw new HttpError(404, 'no account to recover');
    return u as typeof u & { account: Address };
  };
  r.post('/recover/options', h(async (req, res) => {
    const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
    const u = await d.store.userByEmail(email);
    if (!u?.account || !d.recovery) throw new HttpError(404, 'no account for this email');
    res.json({ userId: u.id, options: await registrationOptions(u.id, `recover:${u.id}`, u.email, false) });
  }));
  // Anyone with the email can start one: at most a few recovery passkeys per user an hour, whatever the client address.
  const RECOVERIES_PER_HOUR = 5;
  const recoveries = new Map<string, number[]>();
  r.post('/recover/verify', h(async (req, res) => {
    const b = z.object({ userId: z.string().uuid(), response: z.any() }).parse(req.body);
    const u = await recovering(b.userId);
    const now = Date.now();
    const recent = (recoveries.get(u.id) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= RECOVERIES_PER_HOUR) throw new HttpError(429, 'too many recovery attempts for this account: try again in an hour');
    const p = await verifyRegistration(u.id, `recover:${u.id}`, b.response);
    const started = await d.recovery!.start(u.id, u.account, keyJson(p));
    await savePasskey(p);
    recoveries.set(u.id, [...recent, now]);
    res.json(started);
  }));
  r.get('/recover/:userId', h(async (req, res) => res.json(await d.recovery!.status((await recovering(z.string().uuid().parse(req.params.userId))).account))));
  r.post('/recover/:userId/execute', h(async (req, res) => res.json(await d.recovery!.execute((await recovering(z.string().uuid().parse(req.params.userId))).account))));
  r.get('/recovery', session, h(async (_req, res) => res.json(d.recovery ? await d.recovery.status(res.locals.account) : { state: 'none' })));

  r.get('/me', session, h(async (_req, res) => {
    const u = await d.store.userByAccount(res.locals.account);
    if (!u) throw new HttpError(401, 'unknown account');
    res.json({ userId: u.id, email: u.email, account: u.account });
  }));

  d.extend?.(r, h, session);
  app.use('/api', r);
  d.mount?.(app, h);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest', detail: err.issues.map((i) => i.path.join('.')).join(', ') });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    // A member service or the bundler refused: its answer is what the user needs (e.g. the failed policy rule).
    if (err instanceof UpstreamError) return res.status(err.status < 500 ? err.status : 502).json({ error: err.service, detail: err.body });
    const status = (err as { status?: number }).status;
    if (status && status < 500) return res.status(status).json({ error: (err as Error).message });
    // The api's own refusals (state checks of a request) are plain errors with our own messages.
    if (err instanceof Error && err.constructor === Error) return res.status(409).json({ error: err.message });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}

/** x and y of a COSE EC2 P-256 key (CBOR map with -2 and -3 as 32-byte strings). */
export function coseP256(cose: Uint8Array): { x: bigint; y: bigint } {
  const find = (label: number) => {
    // -2 is 0x21 and -3 is 0x22 in CBOR, followed by a 32-byte string (0x58 0x20).
    const key = label === -2 ? 0x21 : 0x22;
    for (let i = 0; i + 34 <= cose.length; i++) if (cose[i] === key && cose[i + 1] === 0x58 && cose[i + 2] === 0x20) return cose.slice(i + 3, i + 35);
    throw new Error('not a P-256 COSE key');
  };
  return { x: BigInt(`0x${Buffer.from(find(-2)).toString('hex')}`), y: BigInt(`0x${Buffer.from(find(-3)).toString('hex')}`) };
}
