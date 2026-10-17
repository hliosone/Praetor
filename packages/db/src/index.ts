// @praetor/db: one MySQL database and user per service (spec 00), drizzle for queries, ordered SQL migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { createPool, type Pool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';

export type Migration = { name: string; sql: string };
export type SqlRunner = { query(sql: string, params?: unknown[]): Promise<unknown> };

export function loadMigrations(service: string): Migration[] {
  const dir = new URL(`../migrations/${service}/`, import.meta.url);
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ name: f.replace(/\.sql$/, ''), sql: readFileSync(new URL(f, dir), 'utf8') }));
}

/** Applies the missing migrations in name order; returns the names applied. */
export async function migrate(runner: SqlRunner, migrations: Migration[]): Promise<string[]> {
  await runner.query('CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(128) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))');
  const rows = (await runner.query('SELECT name FROM _migrations')) as { name: string }[];
  const done = new Set(rows.map((r) => r.name));
  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue;
    for (const stmt of m.sql.split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await runner.query(stmt);
    await runner.query('INSERT INTO _migrations (name) VALUES (?)', [m.name]);
    applied.push(m.name);
  }
  return applied;
}

export type DbConfig = { host: string; port?: number; user: string; password: string; database: string };

export function connect(c: DbConfig) {
  const pool: Pool = createPool({ host: c.host, port: c.port ?? 3306, user: c.user, password: c.password, database: c.database, connectionLimit: 5 });
  const runner: SqlRunner = { query: async (sql, params) => (await pool.query(sql, params))[0] };
  return { pool, db: drizzle({ client: pool }), runner };
}
