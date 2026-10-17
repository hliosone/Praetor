// agent-runner internal API (spec 05): /wake from the scheduler, /chat from the api (SSE). Docker network only,
// INTERNAL_TOKEN_AGENT bearer.
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { wakeMessage } from './opencode-config.js';
import type { Runner, TurnResult } from './runner.js';

export type RunnerAppDeps = {
  runner: Pick<Runner, 'turn' | 'transcript'>;
  token: string;
  /** Only with the fake LLM configured (automated tests). */
  allowModelOverride: boolean;
  setModel(account: string, model: string): void;
  log?: { info(o: object, m: string): void; error(o: object, m: string): void };
};

const account = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s.toLowerCase());

export function createRunnerApp(d: RunnerAppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    const want = Buffer.from(`Bearer ${d.token}`);
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  const last = new Map<string, TurnResult & { reason: string; at: number; error?: string }>();
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

  app.post('/wake', (req, res) => {
    const b = z.object({ account, reason: z.string().max(32), context: z.record(z.unknown()).default({}) }).parse(req.body);
    res.status(202).json({ queued: true });
    d.runner.turn(b.account, wakeMessage(b.reason, b.context)).then(
      (r) => {
        last.set(b.account, { ...r, reason: b.reason, at: Date.now() });
        d.log?.info({ account: b.account, reason: b.reason, tools: r.tools.map((t) => `${t.tool}:${t.status}`) }, 'wake done');
      },
      (e) => {
        last.set(b.account, { text: '', tools: [], sessionId: '', reason: b.reason, at: Date.now(), error: (e as Error).message });
        d.log?.error({ account: b.account, error: (e as Error).message }, 'wake failed');
      },
    );
  });

  app.post('/chat', h(async (req, res) => {
    const b = z.object({ account, message: z.string().min(1).max(4000) }).parse(req.body);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('event: started\ndata: {}\n\n');
    try {
      const r = await d.runner.turn(b.account, b.message);
      last.set(b.account, { ...r, reason: 'CHAT', at: Date.now() });
      res.write(`event: result\ndata: ${JSON.stringify({ text: r.text, tools: r.tools })}\n\n`);
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
    }
    res.end();
  }));

  app.get('/accounts/:account/last', (req, res) => {
    const r = last.get(account.parse(req.params.account));
    if (!r) return res.status(404).json({ error: 'no turn yet' });
    res.json(r);
  });
  app.get('/accounts/:account/transcript', h(async (req, res) => res.json(await d.runner.transcript(account.parse(req.params.account)))));
  app.put('/accounts/:account/model', (req, res) => {
    if (!d.allowModelOverride) return res.status(403).json({ error: 'model override needs the fake LLM (tests only)' });
    d.setModel(account.parse(req.params.account), z.object({ model: z.string().max(64) }).parse(req.body).model);
    res.status(204).end();
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest' });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
