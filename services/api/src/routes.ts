// The api's routes beyond sign-in (spec 05 endpoint list). Every body is validated; amounts and nonces travel as
// decimal strings; the api only prepares and relays.
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import { encodePolicy, OwnerActionKind as K, type OwnerAction, type Policy } from '@praetor/protocol';
import type { Address, Hex } from 'viem';
import type { Onboarding } from './onboarding.js';
import type { OwnerActions } from './owner-actions.js';
import type { Approvals } from './approvals.js';
import type { WechatLink } from './wechat-link.js';
import type { StandingOrders } from './standing-orders.js';
import type { Audit } from './audit.js';
import type { Clients } from './clients.js';
import { HttpError, type handler } from './app.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as Address);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as Hex);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((s) => s as Hex);
const big = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const assertion = z.object({ id: z.string(), response: z.object({ clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string() }).passthrough() }).passthrough();
const ownerAction = z.object({ account: address, action: z.number().int().min(0).max(12), payloadHash: bytes32, nonce: big, expiresAt: big, fiscoRef: bytes32 });
const policy = z.object({
  autoCap: big, hardCap: big, dailyBudget: big, monthlyBudget: big, dailyCount: z.number().int().min(0).max(65_535), bufferUsdc: big,
  payees: z.array(address).max(32), merchants: z.array(bytes32).max(32),
  bands: z.array(z.object({ token: address, minBps: z.number().int(), targetBps: z.number().int(), maxBps: z.number().int() })).max(8),
  maxRebalancesPerDay: z.number().int().min(0).max(255), maxTradeUsd: big, maxSlippageBps: z.number().int().min(0).max(10_000), validUntil: big, soterEnabled: z.boolean(),
});
const soter = z.object({ code: z.string().min(1).max(128), resultJSON: z.string().min(2).max(4096), resultJSONSignature: z.string().min(1).max(2048), authMode: z.enum(['facial', 'fingerPrint', 'speech']) });

export const send = (res: Response, v: unknown) => {
  res.type('application/json').send(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));
};

export type RouteModules = {
  onboarding: Onboarding;
  ownerActions: OwnerActions;
  approvals: Approvals;
  link: WechatLink;
  standingOrders: StandingOrders;
  audit: Audit;
  /** camt.053.001.02 of the account over [fromMs, toMs], already validated against the XSD. */
  statement(account: Address, fromMs: number, toMs: number): Promise<string>;
  bank: Pick<Clients['bank'], 'policyCheck'>;
  runner: Pick<Clients['runner'], 'chat'>;
  agentKeyOf(account: Address): Promise<Address>;
};

export function apiRoutes(r: Router, h: typeof handler, session: express.RequestHandler, m: RouteModules) {
  const acct = (res: Response) => res.locals.account as Address;

  r.post('/onboarding/account/deploy', session, h(async (_req, res) => send(res, await m.onboarding.deployPrepare(acct(res)))));
  r.post('/onboarding/account/deploy/submit', session, h(async (req, res) => send(res, await m.onboarding.deploySubmit(acct(res), z.object({ assertion }).parse(req.body).assertion))));
  r.post('/onboarding/kyc/start', session, h(async (req, res) => send(res, await m.onboarding.kycStart(acct(res), z.object({ method: z.enum(['vendor', 'eudi']) }).parse(req.body).method))));
  r.get('/onboarding/kyc/status', session, h(async (_req, res) => send(res, await m.onboarding.kycStatus(acct(res)))));
  r.post('/onboarding/suitability', session, h(async (req, res) => send(res, await m.onboarding.suitability(acct(res), z.object({ answers: z.array(z.number().int()).length(5) }).parse(req.body).answers))));
  r.post('/onboarding/agent/create', session, h(async (_req, res) => send(res, await m.onboarding.agentCreate(acct(res)))));
  r.post('/onboarding/kya/draft', session, h(async (_req, res) => send(res, await m.onboarding.mandateDraft(acct(res)))));
  r.post('/onboarding/kya/sign', session, h(async (req, res) => {
    const b = z.object({ draftId: z.string().max(64), challenge: bytes32, agentDidHash: bytes32, assertion }).parse(req.body);
    send(res, await m.onboarding.mandateSign(acct(res), b as never));
  }));

  // Owner actions the web app prepares for the owner to sign (policy and new standing orders have their own routes).
  r.post('/owner-actions/prepare', session, h(async (req, res) => {
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal(K.SET_AGENT_KEY), validUntil: z.number().int() }),
      z.object({ kind: z.literal(K.REVOKE_AGENT_KEY) }),
      z.object({ kind: z.literal(K.PAUSE_AGENT) }),
      z.object({ kind: z.literal(K.RESUME_AGENT) }),
      z.object({ kind: z.literal(K.REMOVE_PAYEE), payee: address }),
      z.object({ kind: z.literal(K.CANCEL_STANDING_ORDER), id: z.number().int().min(1) }),
    ]).parse(req.body);
    const account = acct(res);
    const args = b.kind === K.SET_AGENT_KEY ? { kind: b.kind, account, agentKey: await m.agentKeyOf(account), validUntil: b.validUntil }
      : b.kind === K.REVOKE_AGENT_KEY ? { kind: b.kind, account, agentKey: await m.agentKeyOf(account) }
      : b.kind === K.REMOVE_PAYEE ? { kind: b.kind, account, payee: b.payee }
      : b.kind === K.CANCEL_STANDING_ORDER ? { kind: b.kind, account, id: b.id }
      : { kind: b.kind, account };
    send(res, await m.ownerActions.prepare(account, args as never));
  }));

  r.post('/policy/propose', session, h(async (req, res) => {
    const p = policy.parse(req.body.policy) as unknown as Policy;
    const check = await m.bank.policyCheck(acct(res), encodePolicy(p));
    if (!check.ok) return send(res, { ok: false, failedRule: check.failedRule });
    send(res, { ok: true, fiscoRef: check.fiscoRef, ...(await m.ownerActions.prepare(acct(res), { kind: K.SET_POLICY, account: acct(res), policy: p }, check.fiscoRef)) });
  }));

  r.post('/owner-actions/submit', session, h(async (req, res) => {
    const b = z.object({ ownerAction, payload: hex, assertion }).parse(req.body);
    send(res, await m.ownerActions.submit(acct(res), { ownerAction: b.ownerAction as OwnerAction, payload: b.payload, assertion: b.assertion as never }));
  }));

  r.get('/approvals', session, h(async (req, res) => {
    const state = z.enum(['pending', 'executed', 'failed', 'rejected', 'expired']).optional().parse(req.query.state);
    send(res, { approvals: await m.approvals.list(acct(res), state) });
  }));
  r.get('/approvals/:id', session, h(async (req, res) => {
    const a = await m.approvals.get(acct(res), z.string().max(64).parse(req.params.id));
    if (!a) throw new HttpError(404, 'unknown approval request');
    send(res, a);
  }));
  r.post('/approvals/:id/passkey', session, h(async (req, res) => send(res, await m.approvals.approveWithPasskey(acct(res), String(req.params.id), z.object({ assertion }).parse(req.body).assertion as never))));
  r.post('/approvals/:id/soter', session, h(async (req, res) => send(res, await m.approvals.approveWithSoter(acct(res), String(req.params.id), soter.parse(req.body)))));
  r.post('/approvals/:id/reject', session, h(async (req, res) => {
    await m.approvals.reject(acct(res), String(req.params.id));
    send(res, { state: 'rejected' });
  }));

  const period = z.enum(['weekly', 'monthly']);
  r.get('/standing-orders', session, h(async (_req, res) => send(res, await m.standingOrders.list(acct(res)))));
  r.post('/standing-orders/propose', session, h(async (req, res) => {
    const b = z.union([
      z.object({ proposalId: z.string().uuid(), firstDue: big.optional() }).strict(),
      z.object({ payee: address.optional(), merchant: z.string().max(64).optional(), amount: big, period, firstDue: big.optional() }).strict(),
    ]).parse(req.body);
    send(res, await m.standingOrders.propose(acct(res), b));
  }));
  r.post('/standing-orders/proposals/:id/dismiss', session, h(async (req, res) => {
    await m.standingOrders.dismiss(acct(res), z.string().uuid().parse(req.params.id));
    send(res, { state: 'dismissed' });
  }));
  r.post('/standing-orders/:id/trigger', session, h(async (req, res) => send(res, await m.standingOrders.trigger(acct(res), z.coerce.number().int().min(1).max(2 ** 32 - 1).parse(req.params.id)))));

  // F8: the account's audit trail, the three-way verification, and the ISO 20022 statement.
  const range = (q: unknown) => {
    const b = z.object({ from: z.coerce.number().int().min(0).optional(), to: z.coerce.number().int().min(0).optional() }).parse(q);
    return { from: b.from ?? 0, to: b.to ?? Date.now() };
  };
  r.get('/audit', session, h(async (req, res) => {
    const { from, to } = range(req.query);
    send(res, { entries: await m.audit.list(acct(res), from, to) });
  }));
  r.get('/audit/verify', session, h(async (_req, res) => send(res, await m.audit.verify())));
  r.get('/statements/camt053', session, h(async (req, res) => {
    const { from, to } = range(req.query);
    res.type('application/xml').set('content-disposition', `attachment; filename="praetor-camt053-${acct(res).slice(2, 10)}.xml"`).send(await m.statement(acct(res), from, to));
  }));

  r.post('/wechat/link/start', session, h(async (_req, res) => send(res, await m.link.start(acct(res)))));
  r.get('/wechat/link/:id', session, h(async (req, res) => send(res, await m.link.status(acct(res), String(req.params.id)))));
  r.post('/wechat/link/:id/confirm', session, h(async (req, res) => send(res, await m.link.confirm(acct(res), String(req.params.id), z.object({ assertion }).parse(req.body).assertion as never))));

  // The user's chat with the agent, relayed from agent-runner as server-sent events.
  r.post('/agent/chat', session, h(async (req, res) => {
    const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(req.body);
    const up = await m.runner.chat(acct(res), message);
    res.writeHead(up.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (up.body) for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    res.end();
  }));
}

/** The mini program's link routes: the request id is the capability (the mini program is not signed in yet). */
export function mpRoutes(r: Router, h: typeof handler, link: WechatLink) {
  r.get('/link/:id', h(async (req, res) => send(res, await link.view(String(req.params.id)))));
  r.post('/link/:id/soter', express.json(), h(async (req, res) => send(res, await link.soter(String(req.params.id), soter.parse(req.body)))));
}

/** Internal routes for mcp (INTERNAL_TOKEN_API): approval requests and standing-order proposals from the agent's tools. */
export function internalRoutes(r: Router, h: typeof handler, token: string, approvals: Approvals, standingOrders: StandingOrders) {
  const want = Buffer.from(`Bearer ${token}`);
  r.use((req: Request, res: Response, next: NextFunction) => {
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  const call = z.object({ to: address, value: big, data: hex });
  r.post('/approvals', h(async (req, res) => {
    const b = z.object({ account: address, calls: z.array(call).min(1).max(8), callHash: bytes32, reason: z.string().max(64), summary: z.string().max(280) }).parse(req.body);
    send(res, await approvals.request(b as never));
  }));
  r.get('/approvals/:id', h(async (req, res) => {
    const a = await approvals.get(address.parse(req.query.account), String(req.params.id));
    if (!a) return res.status(404).json({ error: 'unknown' });
    send(res, { state: a.state, registerTx: a.registerTx, executeTx: a.executeTx });
  }));
  // The agent's propose_standing_order: an owner request only (F7 step 1).
  r.post('/standing-order-proposals', h(async (req, res) => {
    const b = z.object({ account: address, payee: address.optional(), merchant: z.string().max(64).optional(), amount: big, period: z.enum(['weekly', 'monthly']), summary: z.string().max(280) }).parse(req.body);
    send(res, await standingOrders.request(b.account, b));
  }));
}

