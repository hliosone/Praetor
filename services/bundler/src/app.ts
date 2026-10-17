import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { fromJson, toJson } from '@praetor/userop';
import { NotAllowed, NotSponsorable, RateLimited, ValidationFailed, type Bundler } from './bundler.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((s) => s as `0x${string}`);

const prepareBody = z.object({ sender: address, callData: hex, validator: z.enum(['agent', 'passkey']), factory: address.optional(), factoryData: hex.optional() });
const sendBody = z.object({ userOp: z.unknown() });
const txBody = z.object({ to: address, data: hex });
const accountBody = z.object({ address });

type Deps = { bundler: Pick<Bundler, 'register' | 'accounts' | 'prepare' | 'send' | 'tx' | 'getOp'>; token: string; health: () => Promise<Record<string, boolean>>; version: string;
  log?: { error(o: object, msg: string): void } };

const STATUS = new Map<Function, number>([[NotSponsorable, 403], [NotAllowed, 403], [RateLimited, 429], [ValidationFailed, 422]]);

// Express 4 does not forward rejected promises to the error handler.
const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

export function createApp(d: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', h(async (_req, res) => {
    const checks = await d.health();
    res.status(Object.values(checks).every(Boolean) ? 200 : 503).json({ ok: Object.values(checks).every(Boolean), ...checks });
  }));
  app.get('/version', (_req, res) => res.json({ service: 'bundler', version: d.version }));

  // Internal callers only (api, mcp, scheduler, member services), on the Docker network (D22).
  const expected = Buffer.from(`Bearer ${d.token}`);
  app.use((req, res, next) => {
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  app.get('/accounts', h(async (_req, res) => {
    res.json({ accounts: await d.bundler.accounts() });
  }));

  app.post('/accounts', h(async (req, res) => {
    await d.bundler.register(accountBody.parse(req.body).address);
    res.status(204).end();
  }));

  app.post('/userop/prepare', h(async (req, res) => {
    const r = await d.bundler.prepare(prepareBody.parse(req.body));
    res.json({ userOp: toJson(r.userOp), userOpHash: r.userOpHash });
  }));

  app.post('/userop/send', h(async (req, res) => {
    const op = fromJson(sendBody.parse(req.body).userOp);
    res.json(json(await d.bundler.send(op)));
  }));

  app.post('/tx', h(async (req, res) => {
    const b = txBody.parse(req.body);
    res.json(await d.bundler.tx(b.to, b.data));
  }));

  app.get('/userop/:hash', h(async (req, res) => {
    const r = await d.bundler.getOp(hex.parse(req.params.hash));
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json(r);
  }));

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest', detail: err.issues.map((i) => i.path.join('.')).join(', ') });
    const status = err instanceof Error ? STATUS.get(err.constructor) : undefined;
    if (status && err instanceof Error) return res.status(status).json({ error: err.constructor.name, detail: err.message });
    d.log?.error({ path: req.path, err: err instanceof Error ? err.message : String(err) }, 'request failed');
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
