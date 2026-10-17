// Link: services to their own MySQL database (spec 00): migrations apply once, drizzle reads and writes.
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { connect, migrate, loadMigrations } from '@praetor/db';
import { accounts } from '@praetor/db/bundler';
import { MYSQL_HOST, dotenv } from './lib/stack.js';

const conn = connect({ host: MYSQL_HOST, user: 'bundler', password: dotenv().MYSQL_PASSWORD_BUNDLER!, database: 'bundler' });

afterAll(async () => conn.pool.end());

describe('bundler database', () => {
  it('applies the migrations once', async () => {
    await migrate(conn.runner, loadMigrations('bundler'));
    expect(await migrate(conn.runner, loadMigrations('bundler'))).toEqual([]);
  });

  it('reads and writes through drizzle', async () => {
    const a = `0x${Date.now().toString(16).padStart(40, '0')}`;
    await conn.db.insert(accounts).values({ address: a });
    const rows = await conn.db.select().from(accounts).where(eq(accounts.address, a));
    expect(rows).toHaveLength(1);
  });
});
