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

  // Owner actions the web app prepares for the owner to sign (policy goes through /policy/propose).
  r.post('/owner-actions/prepare', session, h(async (req, res) => {
    const b = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal(K.SET_AGENT_KEY), validUntil: z.number().int() }),
      z.object({ kind: z.literal(K.REVOKE_AGENT_KEY) }),
      z.object({ kind: z.literal(K.PAUSE_AGENT) }),
      z.object({ kind: z.literal(K.RESUME_AGENT) }),
      z.object({ kind: z.literal(K.REMOVE_PAYEE), payee: address }),
    ]).parse(req.body);
    const account = acct(res);
    const args = b.kind === K.SET_AGENT_KEY ? { kind: b.kind, account, agentKey: await m.agentKeyOf(account), validUntil: b.validUntil }
      : b.kind === K.REVOKE_AGENT_KEY ? { kind: b.kind, account, agentKey: await m.agentKeyOf(account) }
      : b.kind === K.REMOVE_PAYEE ? { kind: b.kind, account, payee: b.payee }
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

/** Internal routes for mcp (INTERNAL_TOKEN_API): approval requests opened by the agent's tools. */
export function internalRoutes(r: Router, h: typeof handler, token: string, approvals: Approvals) {
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
}

