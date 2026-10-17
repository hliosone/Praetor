import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import type { Hex } from 'viem';
import { StaffAuth, StaffError } from './staff.js';

export const BOARDS = ['status', 'assets', 'sanctions', 'jurisdictions', 'attesters', 'mandates', 'audit'] as const;
export type BoardName = (typeof BOARDS)[number];

/** What the HTTP layer needs from FISCO (Consortium in production, fakes in tests). */
export interface ConsortiumPort {
  open(board: BoardName, fn: string, args: readonly unknown[]): Promise<{ proposalId: bigint; digest: Hex; txHash: Hex }>;
  read(board: BoardName, id: bigint): Promise<Record<string, unknown> & { digest: Hex }>;
  sign(board: BoardName, id: bigint): Promise<{ txHash: Hex; ready: boolean }>;
  reissue(board: BoardName, id: bigint): Promise<{ proposalId: bigint; digest: Hex; txHash: Hex }>;
  /** Submit deadline: max(FISCO time, Base time) + ttl, valid on both chains. */
  deadline(ttlSeconds?: number): Promise<bigint>;
}

export type MemberDeps = {
  role: 'bank' | 'regulator' | 'operator';
  consortium: ConsortiumPort;
  staff: StaffAuth;
  token: string;
  health: () => Promise<Record<string, boolean>>;
  version: string;
  /** Role-specific routes (bank: caps, KYA, policy, owner actions...). */
  extend?: (r: Router, helpers: { h: typeof h; staffAssertion: typeof assertionSchema }) => void;
  /** Routes outside the token gate, each authenticating its caller itself (bank: the KYC provider's HMAC callback).
   *  `req.rawBody` holds the exact bytes received. */
  extendPublic?: (r: Router, helpers: { h: typeof h }) => void;
  /** Where unexpected (5xx) failures are reported; the first line of the message only. */
  log?: { error: (o: object, msg: string) => void };
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as Hex);
const hexInt = z.string().regex(/^0x[0-9a-fA-F]+$/).transform((s) => BigInt(s));
export const assertionSchema = z.object({
  credentialId: bytes32, authenticatorData: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((s) => s as Hex), clientDataJSON: z.string(),
  r: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((s) => s as Hex), s: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((s) => s as Hex),
});
// Express 4 does not forward rejected promises to the error handler.
export const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

export function createMemberApp(d: MemberDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  app.get('/health', h(async (_req, res) => {
    const c = await d.health();
    const ok = Object.values(c).every(Boolean);
    res.status(ok ? 200 : 503).json({ ok, ...c });
  }));
  app.get('/version', (_req, res) => res.json({ service: d.role, version: d.version }));

  if (d.extendPublic) {
    const pub = express.Router();
    d.extendPublic(pub, { h });
    app.use(pub);
  }

  const expected = Buffer.from(`Bearer ${d.token}`);
  app.use((req, res, next) => {
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  const key = z.object({ credentialId: bytes32, x: hexInt, y: hexInt, label: z.string().min(1).max(64) });
  app.post('/staff/enrol', h(async (req, res) => {
    const b = key.extend({ token: z.string() }).parse(req.body);
    await d.staff.enrol(b.token, b.credentialId, { x: b.x, y: b.y }, b.label);
    res.status(204).end();
  }));
  app.post('/staff/add', h(async (req, res) => {
    const b = key.extend({ assertion: assertionSchema }).parse(req.body);
    await d.staff.add(b.assertion, b.credentialId, { x: b.x, y: b.y }, b.label);
    res.status(204).end();
  }));

  const boardParam = (req: Request) => ({ board: z.enum(BOARDS).parse(req.params.board), id: BigInt(z.string().regex(/^\d+$/).parse(req.params.id)) });
  app.get('/proposals/:board/:id', h(async (req, res) => {
    const { board, id } = boardParam(req);
    res.json(json(await d.consortium.read(board, id)));
  }));
  app.post('/proposals/:board/:id/sign', h(async (req, res) => {
    const { board, id } = boardParam(req);
    const { assertion } = z.object({ assertion: assertionSchema }).parse(req.body);
    const p = await d.consortium.read(board, id);
    await d.staff.verify(p.digest, assertion);
    res.json(json(await d.consortium.sign(board, id)));
  }));
  app.post('/proposals/:board/:id/reissue', h(async (req, res) => {
    const { board, id } = boardParam(req);
    res.json(json({ board, ...(await d.consortium.reissue(board, id)) }));
  }));

  // Opens any member may do (spec 02 thresholds are enforced by the boards and again by the hook on Base).
  const open = (board: BoardName, fn: string, args: (b: any, deadline: bigint) => readonly unknown[], schema: z.ZodTypeAny) =>
    h(async (req, res) => {
      const b = schema.parse(req.body);
      const deadline = await d.consortium.deadline();
      res.json(json({ board, ...(await d.consortium.open(board, fn, args(b, deadline))) }));
    });
  app.post('/status', open('status', 'openStatus', (b, dl) => [b.account, b.status, dl], z.object({ account: address, status: z.number().int().min(0).max(2) })));
  app.post('/heartbeat', h(async (req, res) => {
    const b = z.object({ ttlSeconds: z.number().int().positive().max(86_400) }).parse(req.body);
    const deadline = await d.consortium.deadline();
    const validUntil = deadline - 3600n + BigInt(b.ttlSeconds);
    res.json(json({ board: 'status', ...(await d.consortium.open('status', 'openHeartbeat', [validUntil, deadline])) }));
  }));
  app.post('/sanctions', open('sanctions', 'openSanctions', (b, dl) => [b.target, b.listed, dl], z.object({ target: address, listed: z.boolean() })));
  app.post('/jurisdictions', open('jurisdictions', 'openJurisdiction', (b, dl) => [`0x${Buffer.from(b.jurisdiction).toString('hex')}`, b.blocked, dl],
    z.object({ jurisdiction: z.string().regex(/^[A-Z]{2}$/), blocked: z.boolean() })));
  app.post('/assets', open('assets', 'openAsset', (b, dl) => [b.asset, b.kind, b.status, b.maxWeightBps, dl],
    z.object({ asset: address, kind: z.number().int().min(0).max(2), status: z.number().int().min(0).max(3), maxWeightBps: z.number().int().min(0).max(10_000) })));
  app.post('/attesters', open('attesters', 'openAttester', (b, dl) => [b.attester, b.measurement, b.active, dl],
    z.object({ attester: address, measurement: bytes32, active: z.boolean() })));

  const router = express.Router();
  d.extend?.(router, { h, staffAssertion: assertionSchema });
  app.use(router);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest', detail: err.issues.map((i) => i.path.join('.')).join(', ') });
    if (err instanceof StaffError) return res.status(403).json({ error: 'StaffError', detail: err.message });
    const status = (err as { status?: number }).status;
    if (status) return res.status(status).json({ error: (err as Error).name, detail: (err as Error).message });
    const detail = (err as Error).message?.split('\n')[0];
    d.log?.error({ path: _req.path, error: (err as Error).name, detail }, 'request failed');
    res.status(500).json({ error: 'Internal', detail });
  });
  return app;
}
