// Mini program sessions (spec 05): a wx.login code, resolved to an openid by code2Session, gives a bearer token for the
// account linked with that WeChat user. The link is recorded only after LINK_WECHAT succeeded on Base and is checked
// against bindingOf(account) at every sign-in and every request, so an unlink or a recovery ends it. The session reads,
// and approves only with a fresh SOTER result that the attester and the hook verify; it can sign no owner action. Only
// keccak256(openid) is kept, never the openid.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';
import { HttpError } from './app.js';
import { WechatError } from './wechat.js';

export const MP_SESSION_TTL_S = 2 * 3600;

export type MpBinding = { account: Address; bindingHash: Hex };

export interface MpBindingStore {
  get(openidHash: Hex): Promise<MpBinding | undefined>;
  /** One WeChat user per account (the hook keeps one binding): replaces whatever the account or the user had. */
  put(openidHash: Hex, b: MpBinding): Promise<void>;
  removeAccount(account: Address): Promise<void>;
}

export class MemoryMpBindingStore implements MpBindingStore {
  rows = new Map<string, MpBinding>();
  async get(openidHash: Hex) { const b = this.rows.get(openidHash.toLowerCase()); return b ? { ...b } : undefined; }
  async put(openidHash: Hex, b: MpBinding) {
    await this.removeAccount(b.account);
    this.rows.set(openidHash.toLowerCase(), { account: b.account.toLowerCase() as Address, bindingHash: b.bindingHash.toLowerCase() as Hex });
  }
  async removeAccount(account: Address) { for (const [k, v] of this.rows) if (v.account === account.toLowerCase()) this.rows.delete(k); }
}

export type MpSession = { openidHash: Hex; account: Address | null; bindingHash: Hex | null };

export type MpSessionDeps = {
  /** SESSION_SECRET; the tokens use a key derived from it for this purpose only. */
  secret: string;
  appId: string;
  code2session: ((code: string) => Promise<string>) | null;
  bindings: MpBindingStore;
  bindingOf(account: Address): Promise<Hex>;
  now?: () => number;
};

const PREFIX = 'mp1';
const NONE = '0';
const bytes32 = Array(4).fill({ type: 'bytes32' });

export class MpSessions {
  private readonly key: Buffer;
  private readonly now: () => number;

  constructor(private readonly d: MpSessionDeps) {
    this.key = createHmac('sha256', d.secret).update('praetor-mp-session-v1').digest();
    this.now = d.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private mac(body: string) {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }

  async login(code: string): Promise<{ token: string; account: Address | null; expiresAt: number }> {
    if (!this.d.code2session) throw new HttpError(503, 'mini program sign-in is not configured');
    let openid: string;
    try {
      openid = await this.d.code2session(code);
    } catch (e) {
      if (e instanceof WechatError) throw new HttpError(401, 'WeChat refused the login code');
      throw e;
    }
    const openidHash = keccak256(toHex(openid));
    let account: Address | null = null;
    const b = await this.d.bindings.get(openidHash);
    if (b) {
      if ((await this.d.bindingOf(b.account)).toLowerCase() === b.bindingHash.toLowerCase()) account = b.account;
      else await this.d.bindings.removeAccount(b.account);
    }
    const expiresAt = this.now() + MP_SESSION_TTL_S;
    const body = `${PREFIX}.${account ?? NONE}.${openidHash}.${expiresAt}`;
    return { token: `${body}.${this.mac(body)}`, account, expiresAt };
  }

  /** The session of a token: signature and expiry, then the link it names must still be the recorded one. */
  async current(token: string): Promise<MpSession | null> {
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== PREFIX) return null;
    const [, account, openidHash, exp, mac] = parts as [string, string, string, string, string];
    const want = Buffer.from(this.mac(parts.slice(0, 4).join('.')));
    const got = Buffer.from(mac);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    if (!/^\d+$/.test(exp) || Number(exp) <= this.now()) return null;
    if (account === NONE) return { openidHash: openidHash as Hex, account: null, bindingHash: null };
    const b = await this.d.bindings.get(openidHash as Hex);
    if (!b || b.account.toLowerCase() !== account) return null;
    // Base may have dropped the binding without the api (executeRecovery, an unlink sent by another client). Refused
    // while Base disagrees; the record stays (a lagging RPC node right after LINK_WECHAT must not unlink the user):
    // sign-in and the api's own unlink remove it.
    if ((await this.d.bindingOf(b.account)).toLowerCase() !== b.bindingHash.toLowerCase()) return null;
    return { openidHash: openidHash as Hex, account: b.account, bindingHash: b.bindingHash };
  }

  /** bindingHash (spec 02) that a SOTER result from this WeChat user gives; null when the result lacks uid or cpu_id. */
  expectedBinding(openidHash: Hex, resultJSON: string): Hex | null {
    let r: { uid?: unknown; cpu_id?: unknown };
    try {
      r = JSON.parse(resultJSON);
    } catch {
      return null;
    }
    if (typeof r?.uid !== 'string' || typeof r.cpu_id !== 'string') return null;
    const k = (s: string) => keccak256(toHex(s));
    return keccak256(encodeAbiParameters(bytes32, [k(this.d.appId), openidHash, k(r.uid), k(r.cpu_id)]));
  }

  linked(openidHash: Hex, account: Address, bindingHash: Hex) {
    return this.d.bindings.put(openidHash, { account, bindingHash });
  }

  unlinked(account: Address) {
    return this.d.bindings.removeAccount(account);
  }
}

/** Bearer token of the mini program; `linked` routes need a session with an account. Sets res.locals.mp (and account). */
export function requireMp(sessions: MpSessions, opts: { linked: boolean }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const m = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '');
    if (!m) return res.status(401).json({ error: 'not signed in' });
    sessions.current(m[1]!).then((s) => {
      if (!s) return res.status(401).json({ error: 'not signed in' });
      if (opts.linked && !s.account) return res.status(403).json({ error: 'WeChat is not linked to an account' });
      res.locals.mp = s;
      res.locals.account = s.account;
      next();
    }, next);
  };
}
