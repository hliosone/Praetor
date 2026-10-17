// Storage of the OAuth server (clients, codes, tokens), SHA-256 hashes only. MySQL in mcp's database; memory in tests.
import type { SqlRunner } from '@praetor/db';

export type Client = { client_id: string; client_secret_hash: string | null; client_name: string | null; redirect_uris: string };
export type Code = { code_hash: string; client_id: string; account: string; redirect_uri: string; code_challenge: string; scope: string; used: boolean; expires_at: number };
export type Token = { token_hash: string; kind: 'access' | 'refresh'; client_id: string; account: string; scope: string; family: string; revoked: boolean; created_at: number; expires_at: number };
export type Grant = { id: string; client_name: string | null; scope: string; created_at: number; expires_at: number };

export interface OAuthStore {
  addClient(c: Client): Promise<void>;
  getClient(id: string): Promise<Client | undefined>;
  addCode(c: Omit<Code, 'used'>): Promise<void>;
  getCode(hash: string): Promise<Code | undefined>;
  markCodeUsed(hash: string): Promise<void>;
  addToken(t: Omit<Token, 'revoked'>): Promise<void>;
  getToken(hash: string): Promise<Token | undefined>;
  revokeFamily(family: string): Promise<void>;
  ownsFamily(family: string, account: string): Promise<boolean>;
  grants(account: string, now: number): Promise<Grant[]>;
}

export class MemoryOAuthStore implements OAuthStore {
  clients = new Map<string, Client>();
  codes = new Map<string, Code>();
  tokens = new Map<string, Token>();
  async addClient(c: Client) { this.clients.set(c.client_id, { ...c }); }
  async getClient(id: string) { return this.clients.get(id); }
  async addCode(c: Omit<Code, 'used'>) { this.codes.set(c.code_hash, { ...c, used: false }); }
  async getCode(hash: string) { return this.codes.get(hash); }
  async markCodeUsed(hash: string) { const c = this.codes.get(hash); if (c) c.used = true; }
  async addToken(t: Omit<Token, 'revoked'>) { this.tokens.set(t.token_hash, { ...t, revoked: false }); }
  async getToken(hash: string) { return this.tokens.get(hash); }
  async revokeFamily(family: string) { for (const t of this.tokens.values()) if (t.family === family) t.revoked = true; }
  async ownsFamily(family: string, account: string) { return [...this.tokens.values()].some((t) => t.family === family && t.account === account); }
  async grants(account: string, now: number) {
    const live = [...this.tokens.values()].filter((t) => t.account === account && !t.revoked && t.expires_at > now);
    const byFamily = new Map<string, Grant>();
    for (const t of live) {
      const g = byFamily.get(t.family) ?? { id: t.family, client_name: this.clients.get(t.client_id)?.client_name ?? null, scope: t.scope, created_at: t.created_at, expires_at: t.expires_at };
      g.created_at = Math.min(g.created_at, t.created_at);
      g.expires_at = Math.max(g.expires_at, t.expires_at);
      byFamily.set(t.family, g);
    }
    return [...byFamily.values()].sort((a, b) => b.created_at - a.created_at);
  }
}

type Row = Record<string, unknown>;
const bool = (v: unknown) => v === true || v === 1 || v === '1';

export class MySqlOAuthStore implements OAuthStore {
  constructor(private readonly r: SqlRunner) {}
  private async one(sql: string, p: unknown[]) { return ((await this.r.query(sql, p)) as Row[])[0]; }
  async addClient(c: Client) {
    await this.r.query('INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)', [c.client_id, c.client_secret_hash, c.client_name, c.redirect_uris, Math.floor(Date.now() / 1000)]);
  }
  async getClient(id: string) {
    const x = await this.one('SELECT * FROM oauth_clients WHERE client_id = ?', [id]);
    return x ? { client_id: String(x.client_id), client_secret_hash: (x.client_secret_hash as string | null) ?? null, client_name: (x.client_name as string | null) ?? null, redirect_uris: String(x.redirect_uris) } : undefined;
  }
  async addCode(c: Omit<Code, 'used'>) {
    await this.r.query('INSERT INTO oauth_codes (code_hash, client_id, account, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [c.code_hash, c.client_id, c.account, c.redirect_uri, c.code_challenge, c.scope, c.expires_at]);
  }
  async getCode(hash: string) {
    const x = await this.one('SELECT * FROM oauth_codes WHERE code_hash = ?', [hash]);
    return x ? { code_hash: String(x.code_hash), client_id: String(x.client_id), account: String(x.account), redirect_uri: String(x.redirect_uri), code_challenge: String(x.code_challenge), scope: String(x.scope), used: bool(x.used), expires_at: Number(x.expires_at) } : undefined;
  }
  async markCodeUsed(hash: string) { await this.r.query('UPDATE oauth_codes SET used = TRUE WHERE code_hash = ?', [hash]); }
  async addToken(t: Omit<Token, 'revoked'>) {
    await this.r.query('INSERT INTO oauth_tokens (token_hash, kind, client_id, account, scope, family, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [t.token_hash, t.kind, t.client_id, t.account, t.scope, t.family, t.created_at, t.expires_at]);
  }
  async getToken(hash: string) {
    const x = await this.one('SELECT * FROM oauth_tokens WHERE token_hash = ?', [hash]);
    return x ? { token_hash: String(x.token_hash), kind: x.kind as Token['kind'], client_id: String(x.client_id), account: String(x.account), scope: String(x.scope), family: String(x.family), revoked: bool(x.revoked), created_at: Number(x.created_at), expires_at: Number(x.expires_at) } : undefined;
  }
  async revokeFamily(family: string) { await this.r.query('UPDATE oauth_tokens SET revoked = TRUE WHERE family = ?', [family]); }
  async ownsFamily(family: string, account: string) { return !!(await this.one('SELECT 1 AS x FROM oauth_tokens WHERE family = ? AND account = ? LIMIT 1', [family, account])); }
  async grants(account: string, now: number) {
    const rows = (await this.r.query(`
      SELECT t.family AS id, c.client_name, t.scope, MIN(t.created_at) AS created_at, MAX(t.expires_at) AS expires_at
      FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
      WHERE t.account = ? AND t.revoked = FALSE AND t.expires_at > ?
      GROUP BY t.family, c.client_name, t.scope ORDER BY created_at DESC`, [account, now])) as Row[];
    return rows.map((x) => ({ id: String(x.id), client_name: (x.client_name as string | null) ?? null, scope: String(x.scope), created_at: Number(x.created_at), expires_at: Number(x.expires_at) }));
  }
}
