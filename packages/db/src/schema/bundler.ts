import { mysqlTable, char, varchar, boolean, json, datetime, int, primaryKey } from 'drizzle-orm/mysql-core';

// Mirrors migrations/bundler (the SQL files are the source of truth for the database).
export const accounts = mysqlTable('accounts', {
  address: char('address', { length: 42 }).primaryKey(),
  registeredAt: datetime('registered_at', { fsp: 3 }),
});

export const userops = mysqlTable('userops', {
  userOpHash: char('user_op_hash', { length: 66 }).primaryKey(),
  sender: char('sender', { length: 42 }).notNull(),
  validator: varchar('validator', { length: 16 }).notNull(),
  txHash: char('tx_hash', { length: 66 }),
  success: boolean('success'),
  reasons: json('reasons').$type<number[]>().notNull(),
  refusalLogTx: char('refusal_log_tx', { length: 66 }),
  createdAt: datetime('created_at', { fsp: 3 }),
});

export const refusals = mysqlTable('refusals', {
  account: char('account', { length: 42 }).notNull(),
  day: int('day').notNull(),
  count: int('count').notNull(),
}, (t) => [primaryKey({ columns: [t.account, t.day] })]);
