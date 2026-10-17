// A browser stand-in for the e2e suite (spec 10: software passkey until Playwright's virtual authenticator in M13):
// talks to the api like the web app does, with its cookies, the CSRF header and a software passkey.
import { type Hex } from 'viem';
import { MandateHookAbi, baseNow } from '@praetor/chain';
import { softPasskey, OwnerActionKind, type SoftPasskey } from '@praetor/protocol';
import { pub, scriptAgent, waitFor, type Stack } from './lib.js';

const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');

export class WebClient {
  cookies = new Map<string, string>();
  passkey: SoftPasskey;
  account?: `0x${string}`;

  constructor(readonly s: Stack, label: string, private readonly base = process.env.API_URL_HOST ?? 'http://10.88.0.80:3200') {
    this.passkey = softPasskey(label, s.rpId, s.origin);
  }

  private store(r: Response) {
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      this.cookies.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
  }

  async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { 'content-type': 'application/json', cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    const csrf = this.cookies.get('praetor_csrf');
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const r = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(r);
    return { status: r.status, body: await r.json().catch(() => null) };
  }

  async ok(method: 'GET' | 'POST', path: string, body?: unknown) {
    const r = await this.call(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
    return r.body;
  }

  /** The passkey's assertion over a 32-byte digest (what the web app asks Face ID to sign). */
  assert(digest: Hex) {
    return this.passkey.authentication(b64(digest));
  }

  /** F1 steps 1 and 2: sign up and create the passkey; the account is the counterfactual Safe. */
  async signUp(email: string) {
    const { userId } = await this.ok('POST', '/api/onboarding/start', { email });
    const options = await this.ok('POST', '/api/onboarding/passkey/options', { userId });
    const v = await this.ok('POST', '/api/onboarding/passkey/verify', { userId, response: this.passkey.registration(options.challenge) });
    this.account = v.account;
    return v as { account: `0x${string}`; credIdHash: Hex };
  }

  /** An owner action prepared by the api, signed here over the digest, submitted. */
  async ownerAction(prepared: { ownerAction: unknown; payload: Hex; digest: Hex }) {
    return this.ok('POST', '/api/owner-actions/submit', { ownerAction: prepared.ownerAction, payload: prepared.payload, assertion: this.assert(prepared.digest) });
  }
}

/** The Demo KYC provider's hosted flow, submitted the way its page does (images are hashed and dropped there). */
export async function kycMockSubmit(redirectUrl: string, person: { fullName: string; birthdate: string; nationality: string; documentNumber: string }, base = process.env.KYC_MOCK_URL_HOST ?? 'http://10.88.0.40:3040') {
  const session = new URL(redirectUrl).searchParams.get('session');
  const img = (t: string) => `data:image/jpeg;base64,${Buffer.from(`e2e-${t}-${session}`).toString('base64')}`;
  const r = await fetch(`${base}/kyc-mock/api/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session, person, idImage: img('id'), selfie: img('selfie'), liveness: { steps: ['left', 'right', 'center'], frames: [img('1'), img('2'), img('3')] } }),
  });
  if (r.status !== 200) throw new Error(`kyc-mock submit: ${r.status}`);
  return r.json();
}

/** F1 steps 1 to 14 through the api, compactly: what F2, F3 and F6 start from. Returns the agent key. */
export async function onboardViaApi(web: WebClient, label: string, person: { fullName: string; birthdate: string; nationality: string; documentNumber: string }, o: { scripted?: boolean } = {}) {
  await web.signUp(`${label}@example.com`);
  const p = await web.ok('POST', '/api/onboarding/account/deploy');
  if (!p.deployed && !(await web.ok('POST', '/api/onboarding/account/deploy/submit', { assertion: web.assert(p.userOpHash) })).success) throw new Error('account not deployed');
  const k = await web.ok('POST', '/api/onboarding/kyc/start', { method: 'vendor' });
  await kycMockSubmit(k.redirectUrl, person);
  await web.ok('POST', '/api/onboarding/suitability', { answers: [1, 1, 1, 1, 1] });
  const agent = await web.ok('POST', '/api/onboarding/agent/create');
  const draft = await web.ok('POST', '/api/onboarding/kya/draft');
  await web.ok('POST', '/api/onboarding/kya/sign', { draftId: draft.draftId, challenge: draft.challenge, agentDidHash: agent.agentDidHash, assertion: web.assert(draft.challenge) });
  const s = web.s;
  await waitFor('KYA on Base', async () => String((await pub(s).readContract({ address: s.base.mandateHook, abi: MandateHookAbi, functionName: 'kyaOf', args: [web.account!] }))[0]).toLowerCase() === String(agent.agentKey).toLowerCase());
  const now = await baseNow(pub(s));
  const sk = await web.ok('POST', '/api/owner-actions/prepare', { kind: OwnerActionKind.SET_AGENT_KEY, validUntil: Number(now + 7_776_000n) });
  if (!(await web.ownerAction(sk)).success) throw new Error('SET_AGENT_KEY failed');
  // Automated tests: the agent runs the scripted model with nothing queued until a test queues its steps, so a
  // scheduler wake never has the real model act on a test account. The evidence run keeps the real model.
  if (o.scripted !== false) await scriptAgent(s, web.account!, []);
  return agent.agentKey as `0x${string}`;
}

/** A Policy as the web app posts it (amounts as decimal strings). */
export const policyJson = (p: Record<string, unknown>) => JSON.parse(JSON.stringify(p, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
