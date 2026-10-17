// The api's MySQL stores (db `api`).
import type { SqlRunner } from '@praetor/db';
import type { ApiStore, Passkey, User } from './store.js';
import type { ApprovalRow, ApprovalState, ApprovalStore } from './approvals.js';
import type { Period, ProposalRow, ProposalState, ProposalStore } from './standing-orders.js';
import { randomUUID } from 'node:crypto';
import type { Address, Hex } from 'viem';
import type { MpBinding, MpBindingStore } from './mp-session.js';

type Row = Record<string, unknown>;
const rows = async (r: SqlRunner, sql: string, p: unknown[] = []) => (await r.query(sql, p)) as Row[];
const user = (x: Row): User => ({ id: String(x.id), email: String(x.email), account: (x.account as string | null) ?? undefined, saltNonce: (x.salt_nonce as string | null) ?? undefined });
const passkey = (x: Row): Passkey => ({ credentialId: String(x.credential_id), userId: String(x.user_id), publicKey: String(x.public_key), counter: Number(x.counter), credIdHash: String(x.cred_id_hash), x: String(x.x), y: String(x.y) });

export class MySqlApiStore implements ApiStore {
  constructor(private readonly r: SqlRunner) {}
  async createUser(email: string) {
    const id = randomUUID();
    await this.r.query('INSERT INTO users (id, email) VALUES (?, ?)', [id, email]);
    return { id, email };
  }
  async getUser(id: string) { const [x] = await rows(this.r, 'SELECT * FROM users WHERE id = ?', [id]); return x ? user(x) : undefined; }
  async userByEmail(email: string) { const [x] = await rows(this.r, 'SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND account IS NOT NULL ORDER BY created_at ASC LIMIT 1', [email]); return x ? user(x) : undefined; }
  async userByAccount(account: string) { const [x] = await rows(this.r, 'SELECT * FROM users WHERE account = ?', [account.toLowerCase()]); return x ? user(x) : undefined; }
  async setAccount(userId: string, account: string, saltNonce: bigint) { await this.r.query('UPDATE users SET account = ?, salt_nonce = ? WHERE id = ?', [account.toLowerCase(), saltNonce.toString(), userId]); }
  async addPasskey(p: Passkey) {
    await this.r.query('INSERT INTO passkeys (credential_id, user_id, public_key, counter, cred_id_hash, x, y) VALUES (?, ?, ?, ?, ?, ?, ?)', [p.credentialId, p.userId, p.publicKey, p.counter, p.credIdHash, p.x, p.y]);
  }
  async passkey(id: string) { const [x] = await rows(this.r, 'SELECT * FROM passkeys WHERE credential_id = ?', [id]); return x ? passkey(x) : undefined; }
  async passkeysOf(userId: string) { return (await rows(this.r, 'SELECT * FROM passkeys WHERE user_id = ?', [userId])).map(passkey); }
  async setCounter(id: string, counter: number) { await this.r.query('UPDATE passkeys SET counter = ? WHERE credential_id = ?', [counter, id]); }
}

const approval = (x: Row): ApprovalRow => ({
  id: String(x.id), account: String(x.account), calls: String(x.calls), callHash: String(x.call_hash) as `0x${string}`, nonce: String(x.nonce), expiresAt: String(x.expires_at),
  digest: String(x.digest) as `0x${string}`, reason: String(x.reason), summary: String(x.summary), state: x.state as ApprovalState, channel: (x.channel as string | null) ?? null,
  registerTx: (x.register_tx as `0x${string}` | null) ?? null, executeTx: (x.execute_tx as `0x${string}` | null) ?? null,
});

export class MySqlApprovalStore implements ApprovalStore {
  constructor(private readonly r: SqlRunner) {}
  async put(a: ApprovalRow) {
    await this.r.query('INSERT INTO approval_requests (id, account, calls, call_hash, nonce, expires_at, digest, reason, summary, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [a.id, a.account, a.calls, a.callHash, a.nonce, a.expiresAt, a.digest, a.reason, a.summary, a.state]);
  }
  async get(id: string) { const [x] = await rows(this.r, 'SELECT * FROM approval_requests WHERE id = ?', [id]); return x ? approval(x) : undefined; }
  async list(account: string, state?: ApprovalState) {
    return (await rows(this.r, `SELECT * FROM approval_requests WHERE account = ?${state ? ' AND state = ?' : ''} ORDER BY created_at DESC LIMIT 100`, state ? [account.toLowerCase(), state] : [account.toLowerCase()])).map(approval);
  }
  async update(id: string, p: Partial<ApprovalRow>) {
    const cols: [string, unknown][] = [];
    if (p.state) cols.push(['state', p.state]);
    if (p.channel !== undefined) cols.push(['channel', p.channel]);
    if (p.registerTx !== undefined) cols.push(['register_tx', p.registerTx]);
    if (p.executeTx !== undefined) cols.push(['execute_tx', p.executeTx]);
    if (p.expiresAt) cols.push(['expires_at', p.expiresAt]);
    if (cols.length) await this.r.query(`UPDATE approval_requests SET ${cols.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map(([, v]) => v), id]);
  }
}

const proposal = (x: Row): ProposalRow => ({
  id: String(x.id), account: String(x.account), payee: (x.payee as string | null) ?? null, merchant: (x.merchant as string | null) ?? null,
  amount: String(x.amount), period: x.period as Period, summary: String(x.summary), state: x.state as ProposalState,
});

export class MySqlProposalStore implements ProposalStore {
  constructor(private readonly r: SqlRunner) {}
  async put(p: ProposalRow) {
    await this.r.query('INSERT INTO standing_order_proposals (id, account, payee, merchant, amount, period, summary, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.account, p.payee, p.merchant, p.amount, p.period, p.summary, p.state]);
  }
  async get(id: string) { const [x] = await rows(this.r, 'SELECT * FROM standing_order_proposals WHERE id = ?', [id]); return x ? proposal(x) : undefined; }
  async list(account: string) {
    return (await rows(this.r, 'SELECT * FROM standing_order_proposals WHERE account = ? ORDER BY created_at DESC LIMIT 100', [account.toLowerCase()])).map(proposal);
  }
  async update(id: string, state: ProposalState) { await this.r.query('UPDATE standing_order_proposals SET state = ? WHERE id = ?', [state, id]); }
}

export class MySqlMpBindingStore implements MpBindingStore {
  constructor(private readonly r: SqlRunner) {}
  // REPLACE removes the rows that collide on the openid hash or on the account (both unique), then inserts.
  async put(openidHash: Hex, b: MpBinding) {
    await this.r.query('REPLACE INTO mp_bindings (openid_hash, account, binding_hash) VALUES (?, ?, ?)', [openidHash.toLowerCase(), b.account.toLowerCase(), b.bindingHash.toLowerCase()]);
  }
  async get(openidHash: Hex) {
    const [x] = await rows(this.r, 'SELECT account, binding_hash FROM mp_bindings WHERE openid_hash = ?', [openidHash.toLowerCase()]);
    return x ? { account: String(x.account) as Address, bindingHash: String(x.binding_hash) as Hex } : undefined;
  }
  async removeAccount(account: Address) { await this.r.query('DELETE FROM mp_bindings WHERE account = ?', [account.toLowerCase()]); }
}
