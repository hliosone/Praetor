// The operator's MySQL audit store (db `operator`): entries as JSON with their source key (one entry per event) and
// the watchers' block cursors.
import type { SqlRunner } from '@praetor/db';
import type { AuditStore, StoredRow } from './audit.js';

type Row = { seq: number; source_key: string; entry: string; ref_id: string; state: string };
const row = (x: Row): StoredRow => ({ entry: JSON.parse(x.entry), key: x.source_key, refId: x.ref_id as `0x${string}`, state: x.state as StoredRow['state'] });

export class MySqlAuditStore implements AuditStore {
  constructor(private readonly r: SqlRunner) {}
  async bindTo(auditLog: string) {
    const [x] = (await this.r.query("SELECT value FROM audit_meta WHERE name = 'auditLog'")) as { value: string }[];
    const want = auditLog.toLowerCase();
    if (x?.value === want) return;
    if (x) {
      await this.r.query('DELETE FROM audit_entries');
      await this.r.query('DELETE FROM audit_cursors');
    }
    await this.r.query("INSERT INTO audit_meta (name, value) VALUES ('auditLog', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [want]);
  }
  private async rows(sql: string, p: unknown[]) { return ((await this.r.query(sql, p)) as Row[]).map(row); }
  async hasKey(key: string) { return ((await this.r.query('SELECT 1 FROM audit_entries WHERE source_key = ?', [key])) as unknown[]).length > 0; }
  async put(r: StoredRow) {
    await this.r.query('INSERT INTO audit_entries (seq, source_key, account, at_ms, entry, ref_id, state) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [r.entry.seq, r.key, r.entry.account.toLowerCase(), r.entry.atMs, JSON.stringify(r.entry), r.refId, r.state]);
  }
  async setState(seq: number, state: StoredRow['state']) { await this.r.query('UPDATE audit_entries SET state = ? WHERE seq = ?', [state, seq]); }
  async pending() { return this.rows("SELECT * FROM audit_entries WHERE state = 'pending' ORDER BY seq", []); }
  async list(fromSeq: number, limit: number, account?: string) {
    return account
      ? this.rows('SELECT * FROM audit_entries WHERE seq >= ? AND account = ? ORDER BY seq LIMIT ?', [fromSeq, account.toLowerCase(), limit])
      : this.rows('SELECT * FROM audit_entries WHERE seq >= ? ORDER BY seq LIMIT ?', [fromSeq, limit]);
  }
  async cursor(name: string): Promise<bigint | null> {
    const [x] = (await this.r.query('SELECT block FROM audit_cursors WHERE name = ?', [name])) as { block: number | string }[];
    return x ? BigInt(x.block) : null;
  }
  async setCursor(name: string, block: bigint) {
    await this.r.query('INSERT INTO audit_cursors (name, block) VALUES (?, ?) ON DUPLICATE KEY UPDATE block = VALUES(block)', [name, block.toString()]);
  }
}
