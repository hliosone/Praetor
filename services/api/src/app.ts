// api (spec 05): the backend of the web app, the mini program and the consoles. Untrusted for safety: it prepares,
// relays and displays; every authority check is on-chain or in a member service.
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { ApiStore } from './store.js';
import { clearSession, requireSession, setSession } from './auth.js';

export type ApiDeps = {
  store: ApiStore;
  sessionSecret: string;
  rpId: string;
  origin: string;
  /** The counterfactual Safe7579 account of a passkey (packages/userop prepareAccount). */
  accountFor(p: { credIdHash: Hex; x: bigint; y: bigint }, saltNonce: bigint): Promise<{ address: Address }>;
  extend?: (r: express.Router, h: typeof handler, session: ReturnType<typeof requireSession>) => void;
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
    challenges.set(`reg:${userId}`, { challenge: options.challenge, at: Date.now() });
    res.json(options);
  }));

  r.post('/onboarding/passkey/verify', h(async (req, res) => {
    const b = z.object({ userId: z.string().uuid(), response: z.any() }).parse(req.body);
    const expectedChallenge = takeChallenge(`reg:${b.userId}`);
    if (!expectedChallenge) throw new HttpError(400, 'no pending registration');
    let info;
    try {
      const v = await verifyRegistrationResponse({ response: b.response, expectedChallenge, expectedOrigin: d.origin, expectedRPID: d.rpId, requireUserVerification: true });
      if (!v.verified || !v.registrationInfo) throw new Error('not verified');
      info = v.registrationInfo;
    } catch {
      throw new HttpError(400, 'passkey registration refused');
    }
    const { x, y } = coseP256(info.credential.publicKey);
    const credIdHash = keccak256(toHex(Buffer.from(info.credential.id, 'base64url')));
    const saltNonce = BigInt(keccak256(toHex(`praetor-account:${b.userId}`))) % 2n ** 64n;
    const { address } = await d.accountFor({ credIdHash, x, y }, saltNonce);
    await d.store.addPasskey({ credentialId: info.credential.id, userId: b.userId, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter, credIdHash, x: x.toString(), y: y.toString() });
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
    if (v.authenticationInfo) await d.store.setCounter(pk.credentialId, v.authenticationInfo.newCounter);
    const u = await d.store.getUser(pk.userId);
    if (!u?.account) throw new HttpError(401, 'no account');
    setSession(res, u.account, d.sessionSecret, secure);
    res.json({ account: u.account });
  }));

  r.post('/auth/logout', session, (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  r.get('/me', session, h(async (_req, res) => {
    const u = await d.store.userByAccount(res.locals.account);
    if (!u) throw new HttpError(401, 'unknown account');
    res.json({ userId: u.id, email: u.email, account: u.account });
  }));

  d.extend?.(r, h, session);
  app.use('/api', r);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest', detail: err.issues.map((i) => i.path.join('.')).join(', ') });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    const status = (err as { status?: number }).status;
    if (status && status < 500) return res.status(status).json({ error: (err as Error).message });
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
