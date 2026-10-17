// Bundler entrypoint: config from env, migrations, then the HTTP API on the internal network.
import type { Server } from 'node:http';
import pino from 'pino';
import { baseClients, loadDeployments } from '@praetor/chain';
import { connect, loadMigrations, migrate } from '@praetor/db';
import { createApp } from './app.js';
import { Bundler } from './bundler.js';
import { ViemChain } from './chain.js';
import { bundlerConfig } from './config.js';
import { MySqlStore } from './store.js';

export async function startBundler(env: Record<string, string | undefined> = process.env): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const cfg = bundlerConfig(env);
  const log = pino({ level: cfg.LOG_LEVEL, redact: ['req.headers.authorization'] });
  const d = loadDeployments(cfg.DEPLOYMENTS_FILE);
  const { publicClient, walletClient } = baseClients(cfg.BASE_RPC_URL, cfg.bundlerKey);
  const conn = connect({ host: cfg.MYSQL_HOST, user: 'bundler', password: cfg.MYSQL_PASSWORD_BUNDLER, database: 'bundler' });
  await migrate(conn.runner, loadMigrations('bundler'));
  const chain = new ViemChain(publicClient as never, walletClient!, d);
  const bundler = new Bundler(chain, new MySqlStore(conn.db), {
    paymaster: d.paymaster,
    paymasterKey: cfg.paymasterKey,
    chainId: d.chainId,
    maxRefusedPerDay: cfg.BUNDLER_MAX_REFUSED_PER_DAY,
    skipRefused: cfg.BUNDLER_SKIP_REFUSED,
    validators: { agent: d.agentKeyValidator, passkey: d.passkeyValidator },
    txTargets: [d.mandateHook, d.anchor, d.standingOrders, d.wecrossInbox, d.refusalLog],
  });
  const health = async () => {
    const rpc = await publicClient.getBlockNumber().then(() => true, () => false);
    const db = await conn.runner.query('SELECT 1').then(() => true, () => false);
    return { rpc, db };
  };
  const app = createApp({ bundler, token: cfg.INTERNAL_TOKEN_BUNDLER, health, version: process.env.npm_package_version ?? '0.0.0', log });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(cfg.PORT, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  log.info({ port, env: cfg.PRAETOR_ENV, chain: cfg.CHAIN_MODE }, 'bundler listening');
  return { server, port, close: async () => { await new Promise((r) => server.close(r)); await conn.pool.end(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBundler().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
