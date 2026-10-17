import { describe, it, expect } from 'vitest';
import { migrate, loadMigrations, type SqlRunner } from '../src/index.js';

function fakeRunner(applied: string[] = []) {
  const log: string[] = [];
  const runner: SqlRunner = {
    async query(sql: string, params?: unknown[]) {
      log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.startsWith('SELECT name FROM _migrations')) return applied.map((name) => ({ name }));
      if (sql.startsWith('INSERT INTO _migrations')) applied.push(String(params?.[0]));
      return [];
    },
  };
  return { runner, log, applied };
}

describe('migrator', () => {
  it('applies missing migrations in name order and records them', async () => {
    const { runner, applied } = fakeRunner();
    const done = await migrate(runner, [{ name: '0002_b', sql: 'CREATE TABLE b (x INT)' }, { name: '0001_a', sql: 'CREATE TABLE a (x INT)' }]);
    expect(done).toEqual(['0001_a', '0002_b']);
    expect(applied).toEqual(['0001_a', '0002_b']);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const { runner } = fakeRunner(['0001_a']);
    expect(await migrate(runner, [{ name: '0001_a', sql: 'CREATE TABLE a (x INT)' }])).toEqual([]);
  });

  it('splits a file into statements on semicolons at line ends', async () => {
    const { runner, log } = fakeRunner();
    await migrate(runner, [{ name: '0001_a', sql: 'CREATE TABLE a (x INT);\nCREATE TABLE b (y INT);\n' }]);
    expect(log.filter((l) => l.startsWith('CREATE TABLE') && l !== 'CREATE TABLE IF')).toEqual(['CREATE TABLE a', 'CREATE TABLE b']);
  });

  it('ships the member-service migrations (staff passkeys)', () => {
    const ms = loadMigrations('member');
    expect(ms[0]!.name).toBe('0001_staff');
    expect(ms[0]!.sql).toMatch(/CREATE TABLE IF NOT EXISTS staff_passkeys/);
  });

  it('ships the api table of mini program links: one per account, keyed by the openid hash, no openid', () => {
    const m = loadMigrations('api').find((x) => x.name === '0003_mp_bindings');
    expect(m?.sql).toMatch(/CREATE TABLE IF NOT EXISTS mp_bindings/);
    expect(m!.sql).toMatch(/openid_hash CHAR\(66\) NOT NULL PRIMARY KEY/);
    expect(m!.sql).toMatch(/account CHAR\(42\) NOT NULL UNIQUE/);
    expect(m!.sql.replace(/^\s*--.*$/gm, '')).not.toMatch(/\bopenid\b(?!_hash)/);
  });

  it('ships the bundler migrations', () => {
    const ms = loadMigrations('bundler');
    expect(ms.map((m) => m.name)[0]).toBe('0001_init');
    expect(ms[0]!.sql).toMatch(/CREATE TABLE IF NOT EXISTS accounts/);
  });
});
