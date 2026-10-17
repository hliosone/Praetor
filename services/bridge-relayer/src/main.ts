// Bridge-relayer entrypoint: polls the FISCO outbox and delivers to Base through the bundler (spec 05).
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import pino from 'pino';
import { z } from 'zod';
import type { Address, PublicClient, WalletClient } from 'viem';
import { baseEnvSchema, loadConfig, resolveKey } from '@praetor/config';
import { baseClients, loadDeployments } from '@praetor/chain';
import { fiscoClients } from '@praetor/fisco-client';
import { Relayer, type TickResult } from './relayer.js';
import { BaseAdapter, FiscoOutbox } from './adapters.js';

const schema = baseEnvSchema.extend({
  BASE_RPC_URL: z.string().url(),
  FISCO_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  FISCO_DEPLOYMENTS_FILE: z.string(),
  BUNDLER_URL: z.string().url().default('http://bundler:3010'),
  INTERNAL_TOKEN_BUNDLER: z.string().min(32),
  BRIDGE: z.enum(['relayer', 'wecross']).default('relayer'),
  BRIDGE_WATCHDOG_S: z.coerce.number().int().positive().default(120),
  RELAYER_POLL_MS: z.coerce.number().int().positive().default(2000),
  PORT: z.coerce.number().int().default(3030),
});

export async function startRelayer(env: Record<string, string | undefined> = process.env) {
  const cfg = loadConfig(schema, env);
  const log = pino({ level: cfg.LOG_LEVEL });
  const base = loadDeployments(cfg.DEPLOYMENTS_FILE);
  const fisco = JSON.parse(readFileSync(cfg.FISCO_DEPLOYMENTS_FILE, 'utf8')) as { baseOutbox: Address };
  const f = fiscoClients(cfg.FISCO_RPC_URL, resolveKey('RELAYER_FISCO_KEY', env));
  const { publicClient } = baseClients(cfg.BASE_RPC_URL);
  const relayer = new Relayer(
    new FiscoOutbox(f.pub as PublicClient, f.wallet as WalletClient, fisco.baseOutbox),
    new BaseAdapter(publicClient as PublicClient, base, { url: cfg.BUNDLER_URL, token: cfg.INTERNAL_TOKEN_BUNDLER }),
    { hook: base.mandateHook, anchor: base.anchor, mode: cfg.BRIDGE, watchdogS: BigInt(cfg.BRIDGE_WATCHDOG_S) },
  );
  let last: { at: number; results: TickResult[] } = { at: 0, results: [] };
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        const results = await relayer.tick();
        for (const r of results) if (r.outcome !== 'waiting') log.info({ id: r.id.toString(), outcome: r.outcome, tx: r.txHash, error: r.error }, 'outbox message');
        last = { at: Date.now(), results };
      } catch (e) {
        log.warn({ error: (e as Error).message.split('\n')[0] }, 'tick failed');
      }
      await new Promise((r) => setTimeout(r, cfg.RELAYER_POLL_MS));
    }
  };
  void loop();
  const app = express();
  app.get('/health', (_req, res) => {
    const fresh = Date.now() - last.at < cfg.RELAYER_POLL_MS * 10;
    res.status(fresh ? 200 : 503).json({ ok: fresh, mode: cfg.BRIDGE, lastTick: last.at });
  });
  app.get('/version', (_req, res) => res.json({ service: 'bridge-relayer', version: '0.1.0' }));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(cfg.PORT, () => resolve(s));
  });
  log.info({ mode: cfg.BRIDGE }, 'bridge-relayer running');
  return { server, port: (server.address() as { port: number }).port, close: async () => { running = false; await new Promise((r) => server.close(r)); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRelayer().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
