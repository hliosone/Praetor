// The consortium console's relay (spec 07): staff log in with passkeys registered in their own member service; the api
// only relays. Console writes need a staff session the member service confirms (proved with a staff passkey over a
// single-use challenge); signatures are staff assertions the member service verifies itself. Agents' statuses are
// chain data, shown without a session.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';

export type Role = 'bank' | 'regulator' | 'operator';
export type MemberCall = (role: Role, method: 'GET' | 'POST', path: string, body?: unknown, session?: string) => Promise<{ status: number; body: unknown }>;

// What the console may open: the member services' own opens (each enforces its thresholds, the hook again on Base).
const ACTIONS = ['status', 'sanctions', 'jurisdictions', 'assets', 'attesters', 'caps', 'heartbeat'] as const;
const role = z.enum(['bank', 'regulator', 'operator']);
const board = z.enum(['status', 'assets', 'sanctions', 'jurisdictions', 'attesters', 'mandates', 'audit']);
const id = z.string().regex(/^\d+$/);

export function consoleRoutes(r: Router, d: { member: MemberCall; agents(): Promise<unknown[]> }) {
  const relay = (res: Response, out: { status: number; body: unknown }) => res.status(out.status).json(out.body);
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => {
    fn(req, res).catch((e) => res.status(e instanceof z.ZodError ? 400 : 502).json({ error: e instanceof z.ZodError ? 'BadRequest' : 'member service unavailable' }));
  };
  /** The staff session of this role's member service, or a 401 already sent. */
  const staff = async (req: Request, res: Response, who: Role): Promise<string | null> => {
    const session = req.header('x-staff-session') ?? '';
    if (!session || (await d.member(who, 'GET', '/staff/session', undefined, session)).status !== 200) {
      res.status(401).json({ error: 'staff session required' });
      return null;
    }
    return session;
  };

  r.get('/agents', h(async (_req, res) => res.json({ agents: await d.agents() })));
  r.post('/:role/challenge', h(async (req, res) => relay(res, await d.member(role.parse(req.params.role), 'POST', '/staff/challenge'))));
  r.post('/:role/login', h(async (req, res) => {
    const b = z.object({ assertion: z.record(z.unknown()) }).parse(req.body);
    relay(res, await d.member(role.parse(req.params.role), 'POST', '/staff/login', b));
  }));
  // A new staff device, approved by an enrolled staff member's assertion (the member service checks it).
  r.post('/:role/staff/add', h(async (req, res) => relay(res, await d.member(role.parse(req.params.role), 'POST', '/staff/add', req.body))));
  r.post('/:role/open', h(async (req, res) => {
    const who = role.parse(req.params.role);
    const b = z.object({ action: z.enum(ACTIONS), params: z.record(z.unknown()) }).parse(req.body);
    if (!(await staff(req, res, who))) return;
    relay(res, await d.member(who, 'POST', `/${b.action}`, b.params));
  }));
  r.get('/:role/proposals/:board/:id', h(async (req, res) => {
    const who = role.parse(req.params.role);
    const path = `/proposals/${board.parse(req.params.board)}/${id.parse(req.params.id)}`;
    if (!(await staff(req, res, who))) return;
    relay(res, await d.member(who, 'GET', path));
  }));
  r.post('/:role/proposals/:board/:id/sign', h(async (req, res) => {
    const who = role.parse(req.params.role);
    const path = `/proposals/${board.parse(req.params.board)}/${id.parse(req.params.id)}/sign`;
    const b = z.object({ assertion: z.record(z.unknown()) }).parse(req.body);
    if (!(await staff(req, res, who))) return;
    relay(res, await d.member(who, 'POST', path, b));
  }));
}
