// Bootstrap shared by the three member services: config from env, their own database, staff passkeys, FISCO
// consortium client bound to the Base domain of the same environment, HTTP API, optional background jobs.
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import pino from 'pino';
import type { Router } from 'express';
import { baseEnvSchema, loadConfig, resolveKey } from '@praetor/config';
import { connect, loadMigrations, migrate } from '@praetor/db';
import { baseClients, baseNow, loadDeployments, type Deployment } from '@praetor/chain';
import { createMemberApp } from './app.js';
import { Consortium, type ConsortiumAddresses } from './consortium.js';
import { MySqlStaffStore, StaffAuth } from './staff.js';

export type Role = 'bank' | 'regulator' | 'operator';

const schema = baseEnvSchema.extend({
  BASE_RPC_URL: z.string().url(),
  FISCO_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  FISCO_DEPLOYMENTS_FILE: z.string(),
  MYSQL_HOST: z.string().default('mysql'),
  INTERNAL_TOKEN_MEMBERS: z.string().min(32),
  PUBLIC_HOST: z.string().default('praetor.localhost'),
  PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  PORT: z.coerce.number().int().default(3020),
});

export type MemberContext = {
  role: Role;
  env: Record<string, string | undefined>;
  consortium: Consortium;
  base: Deployment;
  log: pino.Logger;
  db: ReturnType<typeof connect>['db'];
  runner: ReturnType<typeof connect>['runner'];
};

export type MemberOptions = {
  role: Role;
  env?: Record<string, string | undefined>;
  extend?: (r: Router, ctx: MemberContext) => void;
  extendPublic?: (r: Router, ctx: MemberContext) => void;
  /** Extra migration sets of this member's database (packages/db/migrations/<name>). */
  migrations?: string[];
  jobs?: (ctx: MemberContext) => () => void;
};

export async function startMember(o: MemberOptions): Promise<{ server: Server; port: number; ctx: MemberContext; close: () => Promise<void> }> {
  const env = o.env ?? process.env;
  const R = o.role.toUpperCase();
  const cfg = loadConfig(schema, env);
  const password = env[`MYSQL_PASSWORD_${R}`];
  const enrolToken = env[`STAFF_ENROL_TOKEN_${R}`];
  if (!password || !enrolToken) throw new Error(`missing MYSQL_PASSWORD_${R} or STAFF_ENROL_TOKEN_${R}`);
  const log = pino({ level: cfg.LOG_LEVEL, redact: ['req.headers.authorization'] });
  const conn = connect({ host: cfg.MYSQL_HOST, user: o.role, password, database: o.role });
  await migrate(conn.runner, loadMigrations('member'));
  for (const m of o.migrations ?? []) await migrate(conn.runner, loadMigrations(m));
  const base = loadDeployments(cfg.DEPLOYMENTS_FILE);
  const fisco = JSON.parse(readFileSync(cfg.FISCO_DEPLOYMENTS_FILE, 'utf8')) as ConsortiumAddresses;
  const { publicClient } = baseClients(cfg.BASE_RPC_URL);
  const consortium = new Consortium({
    rpcUrl: cfg.FISCO_RPC_URL, fiscoKey: resolveKey(`${R}_FISCO_KEY`, env), baseSignerKey: resolveKey(`${R}_BASE_SIGNER_KEY`, env),
    addresses: fisco, domain: { name: base.domainName, hook: base.mandateHook }, baseNow: () => baseNow(publicClient),
  });
  const ctx: MemberContext = { role: o.role, env, consortium, base, log, db: conn.db, runner: conn.runner };
  const staff = new StaffAuth(new MySqlStaffStore(conn.db as never), { enrolToken, rpId: cfg.PUBLIC_HOST, origin: cfg.PUBLIC_URL });
  const health = async () => ({
    fisco: await consortium.pub.getBlockNumber().then(() => true, () => false),
    base: await publicClient.getBlockNumber().then(() => true, () => false),
    db: await conn.runner.query('SELECT 1').then(() => true, () => false),
  });
  const app = createMemberApp({ role: o.role, consortium, staff, token: cfg.INTERNAL_TOKEN_MEMBERS, health, version: '0.1.0', log, extend: o.extend ? (r) => o.extend!(r, ctx) : undefined, extendPublic: o.extendPublic ? (r) => o.extendPublic!(r, ctx) : undefined });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(cfg.PORT, () => resolve(s));
  });
  const stopJobs = o.jobs?.(ctx) ?? (() => {});
  const port = (server.address() as { port: number }).port;
  log.info({ port, role: o.role }, 'member service listening');
  return { server, port, ctx, close: async () => { stopJobs(); await new Promise((r) => server.close(r)); await conn.pool.end(); } };
}
