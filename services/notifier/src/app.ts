// notifier (spec 05): one message, every channel the user has (WeChat Official Account, web push; the feed and the
// WebSocket fan-out live in the api). Without the OA test account (BLOCKERS B2) the OA channel is a log sink; the
// outbox keeps what was sent so the e2e suite can assert it.
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { REASONS, txText } from '@praetor/protocol';

export type Notification = { account: string; kind: string; text: string; link?: string };
export type Channel = { name: string; send(n: Notification): Promise<void> };

const PHRASES: Partial<Record<(typeof REASONS)[number], string>> = {
  SANCTIONED: 'payee on the sanctions list',
  OVER_HARD_CAP: 'above your hard cap',
  FROZEN: 'the agent is frozen by the consortium',
  UNKNOWN_PAYEE: 'new payee, your approval is needed',
  OVER_AUTO_CAP: 'above your automatic limit, your approval is needed',
  JURISDICTION_BLOCKED: 'jurisdiction blocked',
  REBALANCE_LIMIT: 'rebalancing limit for today reached',
  STALE_PRICE: 'price too old',
  STALE_STATUS: 'operator heartbeat missing',
};

export function refusalText(r: { reason: number; tier: number; target: string; txHash: string; explorer: string | null }): string {
  const name = REASONS[r.reason];
  return `Blocked: ${(name && PHRASES[name]) ?? name ?? 'refused'}. ${txText(r.explorer, r.txHash)}`;
}

/** A recovery the bank scheduled (F10): the 48 h delay protects the owner only if the owner hears of it in time. */
export function recoveryText(r: { executableAt: bigint; txHash: string; explorer: string | null }): string {
  const at = new Date(Number(r.executableAt) * 1000).toISOString().slice(0, 16).replace('T', ' ');
  return `Recovery of your account scheduled: your passkeys will be replaced after ${at} UTC. Not you? Cancel it now in Settings with one of your passkeys. ${txText(r.explorer, r.txHash)}`;
}

export function decisionText(d: { kind: 'rebalance' | 'payment'; usd: string; asset: string; txHash: string; explorer: string | null }): string {
  return d.kind === 'rebalance' ? `Agent sold ${d.usd} USD of ${d.asset}. ${txText(d.explorer, d.txHash)}` : `Agent paid ${d.usd} USDC. ${txText(d.explorer, d.txHash)}`;
}

export function createNotifierApp(d: { token: string; channels: Channel[]; outboxSize?: number }) {
  const outbox = new Map<string, (Notification & { at: number; channels: string[] })[]>();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const want = Buffer.from(`Bearer ${d.token}`);
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  app.post('/notify', (req, res, next) => {
    (async () => {
      const n = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), kind: z.string().max(32), text: z.string().min(1).max(500), link: z.string().url().optional() }).parse(req.body);
      res.status(202).json({ queued: true });
      const done: string[] = [];
      for (const c of d.channels) {
        try {
          await c.send(n);
          done.push(c.name);
        } catch {
          // A channel down never blocks the others (the feed still has the event).
        }
      }
      const key = n.account.toLowerCase();
      const items = [{ ...n, at: Date.now(), channels: done }, ...(outbox.get(key) ?? [])].slice(0, d.outboxSize ?? 50);
      outbox.set(key, items);
    })().catch(next);
  });
  app.get('/outbox/:account', (req, res) => res.json({ items: outbox.get(String(req.params.account).toLowerCase()) ?? [] }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest' });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
