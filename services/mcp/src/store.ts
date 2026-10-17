// mcp's database: agent bearers and OAuth tokens as SHA-256 hashes only, payee names.
import { randomBytes } from 'node:crypto';
import type { SqlRunner } from '@praetor/db';
import { sha256, type TokenStore } from './app.js';
import { SCOPE } from './oauth.js';

type Row = Record<string, unknown>;

export class MySqlTokenStore implements TokenStore {
  constructor(private readonly r: SqlRunner, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}

  /** A new bearer for the account; the previous one stops working. */
  async issueAgent(account: string): Promise<string> {
    const token = `agt_${randomBytes(32).toString('base64url')}`;
    await this.r.query('REPLACE INTO agent_tokens (account, token_hash) VALUES (?, ?)', [account.toLowerCase(), sha256(token)]);
    return token;
  }

  async agentAccount(token: string): Promise<string | null> {
    const [x] = (await this.r.query('SELECT account FROM agent_tokens WHERE token_hash = ?', [sha256(token)])) as Row[];
    return x ? String(x.account) : null;
  }

  async oauthAccount(token: string): Promise<string | null> {
    const [x] = (await this.r.query("SELECT account FROM oauth_tokens WHERE token_hash = ? AND kind = 'access' AND revoked = FALSE AND expires_at > ? AND scope = ?", [sha256(token), this.now(), SCOPE])) as Row[];
    return x ? String(x.account) : null;
  }

  async setLabels(account: string, labels: { address: string; label: string }[]): Promise<void> {
    for (const l of labels) await this.r.query('REPLACE INTO payee_labels (account, address, label) VALUES (?, ?, ?)', [account.toLowerCase(), l.address.toLowerCase(), l.label]);
  }
}
