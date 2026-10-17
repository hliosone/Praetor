// MySQL stores of the bank's KYC and mandate drafts (db `bank`, migrations packages/db/migrations/bank).
import type { SqlRunner } from '@praetor/db';
import type { Hex } from 'viem';
import type { KycRecord, KycSession, KycStore } from './kyc.js';
import type { MandateDraft, MandateStore } from './mandate.js';

type Row = Record<string, unknown>;
const rows = async (r: SqlRunner, sql: string, p: unknown[] = []) => (await r.query(sql, p)) as Row[];
const affected = (res: unknown) => (res as { affectedRows?: number }).affectedRows ?? 0;
const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));

export class MySqlKycStore implements KycStore {
  constructor(private readonly r: SqlRunner) {}
  async createSession(s: KycSession) {
    await this.r.query('INSERT INTO kyc_sessions (id, user_ref, account, method, state, eudi_tx) VALUES (?, ?, ?, ?, ?, ?)', [s.id, s.userRef, s.account, s.method, s.state, s.eudiTx ?? null]);
  }
  async getSession(id: string) {
    const [s] = await rows(this.r, 'SELECT * FROM kyc_sessions WHERE id = ?', [id]);
    return s ? { id: String(s.id), userRef: String(s.user_ref), account: String(s.account), method: s.method as KycSession['method'], state: s.state as KycSession['state'], eudiTx: opt<string>(s.eudi_tx) } : undefined;
  }
  async decideSession(id: string) {
    return affected(await this.r.query("UPDATE kyc_sessions SET state = 'decided' WHERE id = ? AND state = 'pending'", [id])) === 1;
  }
  async recordByAccount(account: string): Promise<KycRecord | undefined> {
    const [x] = await rows(this.r, 'SELECT user_ref FROM kyc_records WHERE LOWER(account) = LOWER(?) ORDER BY updated_at DESC LIMIT 1', [account]);
    return x ? this.getRecord(String(x.user_ref)) : undefined;
  }

  async getRecord(userRef: string): Promise<KycRecord | undefined> {
    const [x] = await rows(this.r, 'SELECT * FROM kyc_records WHERE user_ref = ?', [userRef]);
    if (!x) return undefined;
    return {
      userRef: String(x.user_ref), account: String(x.account), method: x.method as KycRecord['method'], state: x.state as KycRecord['state'],
      reason: opt(x.reason), sealed: opt(x.sealed), ageOver18: x.age_over_18 === null ? undefined : Boolean(x.age_over_18),
      jurisdiction: opt(x.jurisdiction), kycLevel: opt(x.kyc_level), sanctionsScreened: opt(x.sanctions_screened), riskProfile: opt(x.risk_profile),
      userWeId: opt(x.user_weid), credential: x.credential ? JSON.parse(String(x.credential)) : undefined, credentialHash: opt(x.credential_hash),
    };
  }
  async putRecord(k: KycRecord) {
    await this.r.query(
      `REPLACE INTO kyc_records (user_ref, account, method, state, reason, sealed, age_over_18, jurisdiction, kyc_level, sanctions_screened, risk_profile, user_weid, credential, credential_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [k.userRef, k.account, k.method, k.state, k.reason ?? null, k.sealed ?? null, k.ageOver18 ?? null, k.jurisdiction ?? null, k.kycLevel ?? null,
        k.sanctionsScreened ?? null, k.riskProfile ?? null, k.userWeId ?? null, k.credential ? JSON.stringify(k.credential) : null, k.credentialHash ?? null],
    );
  }
}

export class MySqlMandateStore implements MandateStore {
  constructor(private readonly r: SqlRunner) {}
  async put(d: MandateDraft) {
    await this.r.query('INSERT INTO mandate_drafts (id, user_ref, account, inner_credential, challenge, state) VALUES (?, ?, ?, ?, ?, ?)', [d.id, d.userRef, d.account, d.inner, d.challenge, d.state]);
  }
  async get(id: string) {
    const [d] = await rows(this.r, 'SELECT * FROM mandate_drafts WHERE id = ?', [id]);
    return d ? { id: String(d.id), userRef: String(d.user_ref), account: String(d.account), inner: String(d.inner_credential), challenge: String(d.challenge) as Hex, state: d.state as MandateDraft['state'] } : undefined;
  }
  async markSigned(id: string) {
    return affected(await this.r.query("UPDATE mandate_drafts SET state = 'signed' WHERE id = ? AND state = 'pending'", [id])) === 1;
  }
}

export class MySqlKv {
  constructor(private readonly r: SqlRunner) {}
  async get(k: string) {
    const [x] = await rows(this.r, 'SELECT v FROM bank_identity WHERE k = ?', [k]);
    return x ? String(x.v) : undefined;
  }
  async set(k: string, v: string) {
    await this.r.query('REPLACE INTO bank_identity (k, v) VALUES (?, ?)', [k, v]);
  }
}
