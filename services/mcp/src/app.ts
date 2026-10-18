// mcp HTTP app (spec 05): MCP over streamable HTTP (stateless, one server per request, scoped to the bearer's
// account), adapted from BSA Sentry apps/server/src/mcp.ts. Our own agent uses a static per-account bearer accepted
// only from the agent network (never through Caddy, whose traffic must use OAuth); internal routes take the
// INTERNAL_TOKEN_MCP bearer.
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { callHash } from '@praetor/protocol';
import { PraetorTools, type Ports, type ToolResult } from './tools.js';

export interface TokenStore {
  issueAgent(account: string): Promise<string>;
  agentAccount(token: string): Promise<string | null>;
  oauthAccount(token: string): Promise<string | null>;
  setLabels(account: string, labels: { address: string; label: string }[]): Promise<void>;
}

export type McpAppDeps = {
  tokens: TokenStore;
  ports: () => Ports;
  /** agent-runner's credential (agent bearers). */
  internalToken: string;
  /** The api's credential (payee names). */
  apiToken: string;
  agentSubnet: string;
  baseUrl: string;
  /** The peer address (tests inject it); never X-Forwarded-For. */
  remoteAddress?: (req: Request) => string | undefined;
  /** Extra public routes (OAuth). */
  extra?: (app: express.Express) => void;
  /** Whether the hook holds a live, unconsumed owner approval for this callHash (resubmission, F6 step 8). */
  liveApproval: (account: Address, callHash: Hex) => Promise<boolean>;
};

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function inSubnet(ip: string | undefined, cidr: string): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const [net, bits] = cidr.split('/');
  const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(v4) || !net) return false;
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (toInt(v4) & mask) === (toInt(net) & mask);
}

const out = (r: ToolResult) => ({ content: [{ type: 'text' as const, text: r.text }], ...(r.structured ? { structuredContent: r.structured } : {}), ...(r.isError ? { isError: true } : {}) });

export function buildMcpServer(account: Address, ports: Ports): McpServer {
  const t = new PraetorTools(account, ports);
  const s = new McpServer({ name: 'praetor', version: '0.1.0' });
  const usd = z.string().describe('USD amount, e.g. "12.50"');
  const asset = z.enum(['USDC', 'tXAU', 'tXAG']);
  s.registerTool('get_portfolio', { title: 'Portfolio', description: 'Balances, USD values, weights against the bands of the mandate, prices (says when they are demo prices).', inputSchema: {} }, async () => out(await t.getPortfolio()));
  s.registerTool('get_mandate', { title: 'Mandate', description: "The owner's rules in plain words: caps, budgets and what was spent today and in the 30-day period (as the hook counts it), known payees (with names), bands, rebalancing limits.", inputSchema: {} }, async () => out(await t.getMandate()));
  s.registerTool('get_status', { title: 'Status', description: 'Whether the account is active, restricted or frozen, the operator heartbeat, KYA validity.', inputSchema: {} }, async () => out(await t.getStatus()));
  s.registerTool('get_activity', { title: 'Activity', description: 'Recent decisions and refusals with transaction links.', inputSchema: { limit: z.number().int().min(1).max(50).optional() } }, async ({ limit }) => out(await t.getActivity(limit ?? 10)));
  s.registerTool('explain', {
    title: 'Dry run', description: "Asks the on-chain mandate whether a payment or a rebalance would pass, needs the owner's approval (then pay or rebalance sends the owner the approval request), or would be refused for good, and why. Sends nothing and asks no one.",
    inputSchema: { type: z.enum(['pay', 'rebalance']), payee: z.string().optional(), amount: usd.optional(), sell: asset.optional(), buy: asset.optional(), amountUsd: usd.optional() },
  }, async (a) => out(a.type === 'pay'
    ? await t.explain({ type: 'pay', payee: a.payee ?? '', amount: a.amount ?? '' })
    : await t.explain({ type: 'rebalance', sell: a.sell ?? '', buy: a.buy ?? '', amountUsd: a.amountUsd ?? '' })));
  s.registerTool('pay', {
    title: 'Pay', description: 'Pays USDC to a payee (address, or a name from get_mandate). The mandate decides: done, waiting for the owner (approval requested), or blocked for good.',
    inputSchema: { payee: z.string(), amount: usd, memo: z.string().max(140).optional() },
  }, async (a) => out(await t.pay(a)));
  s.registerTool('rebalance', {
    title: 'Rebalance', description: 'Swaps one asset for another at the treasury desk (oracle price, slippage limit from the mandate) to bring weights back into their bands.',
    inputSchema: { sell: asset, buy: asset, amountUsd: usd },
  }, async (a) => out(await t.rebalance(a)));
  s.registerTool('get_approval', { title: 'Approval request', description: 'State of an approval request created by pay or rebalance.', inputSchema: { id: z.string().max(64) } }, async ({ id }) => out(await t.getApproval(id)));
  s.registerTool('propose_standing_order', {
    title: 'Propose a standing order', description: 'Asks the owner to set a fixed recurring payment, either to a payee (direct USDC) or to a merchant code (paid through the payout partner, e.g. rent). Creates an owner request only; nothing happens on-chain until the owner and the bank sign it.',
    inputSchema: { payee: z.string().max(100).optional(), merchant: z.string().max(64).optional(), amount: usd, period: z.enum(['weekly', 'monthly']) },
  }, async (a) => out(await t.proposeStandingOrder(a)));
  s.registerTool('trigger_standing_order', { title: 'Run a standing order', description: 'Executes a standing order the owner set, when it is due.', inputSchema: { id: z.number().int().min(0) } }, async ({ id }) => out(await t.triggerStandingOrder(id)));
  return s;
}

export function createMcpApp(d: McpAppDeps) {
  const app = express();
  app.disable('x-powered-by');
  const peer = d.remoteAddress ?? ((req: Request) => req.socket.remoteAddress);
  const meta = `${d.baseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`;
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const bearerOf = (token: string) => (req: Request, res: Response, next: NextFunction) => {
    const want = Buffer.from(`Bearer ${token}`);
    const got = Buffer.from(req.header('authorization') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
  const internal = bearerOf(d.internalToken);
  const api = bearerOf(d.apiToken);
  const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
  app.post('/internal/agent-token', express.json(), internal, h(async (req, res) => {
    const { account } = z.object({ account: address }).parse(req.body);
    res.json({ token: await d.tokens.issueAgent(account.toLowerCase()) });
  }));
  app.put('/internal/payee-labels', express.json(), api, h(async (req, res) => {
    const b = z.object({ account: address, labels: z.array(z.object({ address, label: z.string().min(1).max(64) })).max(100) }).parse(req.body);
    await d.tokens.setLabels(b.account.toLowerCase(), b.labels);
    res.status(204).end();
  }));

  // The api resubmits a call its owner approved (F6 step 8): same calls, the agent's TEE signature, the hook finds the
  // live approval and consumes it.
  app.post('/internal/resubmit', express.json(), api, h(async (req, res) => {
    const call = z.object({ to: address, value: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)), data: z.string().regex(/^0x[0-9a-fA-F]*$/) });
    // An approval is for one call (its callHash, F6): only a call the owner approved on Base, still live, is resubmitted,
    // so a holder of the api token cannot have the agent key sign anything else.
    const b = z.object({ account: address, calls: z.array(call).length(1) }).parse(req.body);
    const c = b.calls[0]!;
    if (!(await d.liveApproval(b.account as Address, callHash({ account: b.account as Address, target: c.to as Address, value: c.value, data: c.data as Hex })))) {
      return res.status(409).json({ error: 'no live approval for this call' });
    }
    const s = await d.ports().submit(b.account as Address, b.calls as never);
    res.json({ success: s.success, txHash: s.txHash, userOpHash: s.userOpHash, reasons: s.reasons });
  }));

  d.extra?.(app);

  const bearer = h(async (req, res) => {
    const raw = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '')?.[1] ?? '';
    let account: string | null = null;
    if (raw && inSubnet(peer(req), d.agentSubnet)) account = await d.tokens.agentAccount(raw);
    if (!account && raw) account = await d.tokens.oauthAccount(raw);
    if (!account) return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${meta}"`).json({ error: 'unauthorized' });
    const server = buildMcpServer(account as Address, d.ports());
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.post('/mcp', express.json({ limit: '256kb' }), bearer);
  app.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());
  app.delete('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest' });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
