// KYC at the bank (spec 05, F1 steps 5 to 7): a session per attempt (Demo KYC provider or EUDI wallet), the provider's
// decision, sanctions name screening, suitability, then the user's WeID and a PersonKYC credential issued by the bank
// with its evidence. Personal data exists only inside the sealed record (AES-256-GCM, KYC_ENC_KEY); nothing returned by
// this module, and nothing it logs, contains it (I9).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Credential } from '@praetor/weid-client';
import { buildPresentationRequest, qrUrl, jurisdictionOf, type Transaction } from './eudiw.js';

/** A business refusal (HTTP 409), as opposed to an infrastructure failure. */
export class Refused extends Error {
  status = 409;
  name = 'Refused';
}

export type RiskProfileName = 'conservative' | 'balanced' | 'growth';
export type KycMethod = 'vendor' | 'eudi';
export type KycState = 'pending' | 'verified' | 'rejected' | 'issued' | 'revoked';
export type RejectReason = 'provider' | 'liveness' | 'age' | 'sanctions' | 'jurisdiction';

/** Five answers, each 0 (cautious) to 2 (risk-seeking): total 0-3 conservative, 4-7 balanced, 8-10 growth. */
export function scoreSuitability(answers: number[]): RiskProfileName {
  if (answers.length !== 5 || answers.some((a) => !Number.isInteger(a) || a < 0 || a > 2)) throw new Error('five answers in 0..2 expected');
  const total = answers.reduce((s, a) => s + a, 0);
  return total <= 3 ? 'conservative' : total <= 7 ? 'balanced' : 'growth';
}

const nameTokens = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');

/** Same tokens as a listed name, whatever the case, accents, spacing or order. */
export function screenName(fullName: string, list: string[]): boolean {
  const n = nameTokens(fullName);
  return n.length > 0 && list.some((l) => nameTokens(l) === n);
}

function encKey(hex: string): Buffer {
  const k = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  if (k.length !== 32) throw new Error('KYC_ENC_KEY must be 32 bytes of hex');
  return k;
}

/** base64(iv 12 || tag 16 || ciphertext). */
export function sealRecord(keyHex: string, record: object): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(keyHex), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(record), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function openRecord<T = Record<string, unknown>>(keyHex: string, sealed: string): T {
  const b = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', encKey(keyHex), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')) as T;
}

export const signVendorBody = (secret: string, raw: Buffer) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

export function checkVendorSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const want = Buffer.from(signVendorBody(secret, raw));
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}

function adultOn(birthdate: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
  const eighteenth = [y + 18, mo, d];
  for (let i = 0; i < 3; i++) if (today[i] !== eighteenth[i]) return today[i]! > eighteenth[i]!;
  return true;
}

export type KycSession = { id: string; userRef: string; account: string; method: KycMethod; state: 'pending' | 'decided'; eudiTx?: string };
export type KycRecord = {
  userRef: string;
  /** The Base account this person's KYC and mandates are bound to (set at the first session). */
  account: string;
  method: KycMethod;
  state: KycState;
  reason?: RejectReason;
  sealed?: string;
  ageOver18?: boolean;
  jurisdiction?: string;
  kycLevel?: number;
  sanctionsScreened?: string;
  riskProfile?: RiskProfileName;
  userWeId?: string;
  credential?: Credential;
  credentialHash?: string;
};

export interface KycStore {
  createSession(s: KycSession): Promise<void>;
  getSession(id: string): Promise<KycSession | undefined>;
  decideSession(id: string): Promise<boolean>;
  getRecord(userRef: string): Promise<KycRecord | undefined>;
  putRecord(r: KycRecord): Promise<void>;
}

export class MemoryKycStore implements KycStore {
  sessions = new Map<string, KycSession>();
  records = new Map<string, KycRecord>();
  async createSession(s: KycSession) { this.sessions.set(s.id, { ...s }); }
  async getSession(id: string) { return this.sessions.get(id); }
  async decideSession(id: string) {
    const s = this.sessions.get(id);
    if (!s || s.state !== 'pending') return false;
    s.state = 'decided';
    return true;
  }
  async getRecord(userRef: string) { return this.records.get(userRef); }
  async putRecord(r: KycRecord) { this.records.set(r.userRef, { ...r }); }
}

export type KycWeid = {
  createWeId(): Promise<string>;
  createCredential(a: { cptId: number; issuer: string; expiresAt: Date; claim: Record<string, unknown> }): Promise<Credential>;
  createEvidence(c: Credential, signerWeId: string): Promise<string>;
  revoke(c: Credential, signerWeId: string): Promise<void>;
};

export type BankIdentity = { bankWeId: string; kycCpt: number; mandateCpt: number };

export type VendorResult = {
  sessionId: string;
  decision: 'approved' | 'rejected';
  liveness: boolean;
  person: { fullName: string; birthdate: string; nationality: string; documentNumber: string };
  docHash: string;
  selfieHash: string;
};

export type KycDeps = {
  store: KycStore;
  weid: KycWeid;
  encKey: string;
  sanctions: string[];
  identity: () => Promise<BankIdentity>;
  publicUrl: string;
  now?: () => Date;
  eudi?: { backend: string; intendedUseId: string; scheme?: string };
};

const CREDENTIAL_DAYS = 365;

export class KycService {
  private readonly now: () => Date;
  constructor(private readonly d: KycDeps) {
    encKey(d.encKey);
    this.now = d.now ?? (() => new Date());
  }

  async startSession(userRef: string, method: KycMethod, account: string, eudi?: { createTransaction: (body: unknown) => Promise<Transaction> }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Refused('bad account');
    const current = await this.d.store.getRecord(userRef);
    if (current && current.account.toLowerCase() !== account.toLowerCase()) throw new Refused('user bound to another account');
    if (current && (current.state === 'issued' || current.state === 'verified')) throw new Refused('KYC already done for this user');
    const id = randomUUID();
    if (method === 'vendor') {
      await this.d.store.createSession({ id, userRef, account, method, state: 'pending' });
      return { sessionId: id, redirectUrl: `${this.d.publicUrl}/kyc-mock/?session=${id}` };
    }
    if (!eudi) throw new Error('EUDI verifier not configured');
    const t = await eudi.createTransaction(buildPresentationRequest({ nonce: randomUUID(), intendedUseId: this.d.eudi?.intendedUseId ?? '' }));
    await this.d.store.createSession({ id, userRef, account, method, state: 'pending', eudiTx: t.transactionId });
    return { sessionId: id, qr: qrUrl(this.d.eudi?.scheme ?? 'openid4vp', t), transactionId: t.transactionId };
  }

  private async decide(sessionId: string, method: KycMethod) {
    const s = await this.d.store.getSession(sessionId);
    if (!s || s.method !== method) throw new Refused('unknown session');
    if (!(await this.d.store.decideSession(sessionId))) throw new Refused('session not pending');
    return s;
  }

  private async reject(s: KycSession, reason: RejectReason) {
    await this.d.store.putRecord({ userRef: s.userRef, account: s.account, method: s.method, state: 'rejected', reason });
  }

  async vendorResult(r: VendorResult): Promise<void> {
    const s = await this.decide(r.sessionId, 'vendor');
    if (r.decision !== 'approved') return this.reject(s, 'provider');
    if (!r.liveness) return this.reject(s, 'liveness');
    if (!adultOn(r.person.birthdate, this.now())) return this.reject(s, 'age');
    if (screenName(r.person.fullName, this.d.sanctions)) return this.reject(s, 'sanctions');
    const jurisdiction = jurisdictionOf({ ageOver18: true, country: r.person.nationality });
    if (!jurisdiction) return this.reject(s, 'jurisdiction');
    await this.d.store.putRecord({
      userRef: s.userRef, account: s.account, method: 'vendor', state: 'verified',
      sealed: sealRecord(this.d.encKey, { ...r.person, docHash: r.docHash, selfieHash: r.selfieHash, method: 'vendor' }),
      ageOver18: true, jurisdiction, kycLevel: 2, sanctionsScreened: this.today(),
    });
  }

  /** The wallet discloses no name, so there is nothing to screen: kycLevel 1 (D30). */
  async eudiResult(sessionId: string, id: { ageOver18: boolean; country: string | null }): Promise<void> {
    const s = await this.decide(sessionId, 'eudi');
    if (!id.ageOver18) return this.reject(s, 'age');
    const jurisdiction = jurisdictionOf(id);
    if (!jurisdiction) return this.reject(s, 'jurisdiction');
    await this.d.store.putRecord({
      userRef: s.userRef, account: s.account, method: 'eudi', state: 'verified',
      sealed: sealRecord(this.d.encKey, { ageOver18: true, country: jurisdiction, method: 'eudi' }),
      ageOver18: true, jurisdiction, kycLevel: 1, sanctionsScreened: this.today(),
    });
  }

  async sessionOf(sessionId: string) {
    return this.d.store.getSession(sessionId);
  }

  async suitability(userRef: string, answers: number[]) {
    const riskProfile = scoreSuitability(answers);
    const r = await this.d.store.getRecord(userRef);
    if (!r || r.state !== 'verified') throw new Refused('KYC not verified');
    const { bankWeId, kycCpt } = await this.d.identity();
    const userWeId = await this.d.weid.createWeId();
    const claim = { holder: userWeId, ageOver18: r.ageOver18 === true, jurisdiction: r.jurisdiction!, riskProfile, sanctionsScreened: r.sanctionsScreened!, kycLevel: r.kycLevel! };
    const credential = await this.d.weid.createCredential({ cptId: kycCpt, issuer: bankWeId, expiresAt: new Date(this.now().getTime() + CREDENTIAL_DAYS * 86400_000), claim });
    const credentialHash = await this.d.weid.createEvidence(credential, bankWeId);
    await this.d.store.putRecord({ ...r, state: 'issued', riskProfile, userWeId, credential, credentialHash });
    return this.status(userRef);
  }

  async revoke(userRef: string) {
    const r = await this.d.store.getRecord(userRef);
    if (!r || r.state !== 'issued' || !r.credential) throw new Refused('no issued credential');
    const { bankWeId } = await this.d.identity();
    await this.d.weid.revoke(r.credential, bankWeId);
    await this.d.store.putRecord({ ...r, state: 'revoked' });
  }

  /** What other services may see: never the sealed record. */
  async record(userRef: string) {
    return this.d.store.getRecord(userRef);
  }

  async status(userRef: string) {
    const r = await this.d.store.getRecord(userRef);
    if (!r) return { state: 'none' as const };
    return {
      state: r.state, reason: r.reason, method: r.method, account: r.account, jurisdiction: r.jurisdiction, kycLevel: r.kycLevel, riskProfile: r.riskProfile,
      userWeId: r.userWeId, credentialHash: r.credentialHash,
    };
  }

  private today() {
    return this.now().toISOString().slice(0, 10);
  }
}
