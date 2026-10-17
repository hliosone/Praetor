// api entrypoint (spec 05): config from env, its own database, clients of the internal services, the HTTP app.
import express from 'express';
import pino from 'pino';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { erc20Abi, parseAbiItem, type Address, type Hex } from 'viem';
import { AuditLogAbi, fiscoClients } from '@praetor/fisco-client';
import { AnchorAbi, MandateHookAbi, StandingOrdersAbi, accountReader, baseClients, baseNow, loadDeployments } from '@praetor/chain';
import { connect, loadMigrations, migrate } from '@praetor/db';
import { prepareAccount } from '@praetor/userop';
import { createApiApp } from './app.js';
import { clients, UpstreamError } from './clients.js';
import { MySqlApiStore, MySqlApprovalStore, MySqlProposalStore } from './mysql.js';
import { StandingOrders, type Directory } from './standing-orders.js';
import { Audit, type AuditRow } from './audit.js';
import { balanceAt, camt053, camtErrors, statementEntries } from './statement.js';
import { Views } from './views.js';
import { consoleRoutes, type MemberCall } from './console.js';
import { Onboarding } from './onboarding.js';
import { OwnerActions } from './owner-actions.js';
import { Approvals } from './approvals.js';
import { WechatLink } from './wechat-link.js';
import { apiRoutes, internalRoutes, mpRoutes } from './routes.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  MYSQL_HOST: z.string().default('mysql'),
  MYSQL_PASSWORD_API: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_HOST: z.string().default('praetor.localhost'),
  PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  BUNDLER_URL: z.string().url().default('http://bundler:3010'),
  INTERNAL_TOKEN_BUNDLER: z.string().min(32),
  BANK_URL: z.string().url().default('http://bank:3020'),
  INTERNAL_TOKEN_MEMBERS: z.string().min(32),
  AGENT_SIGNER_URL: z.string().url().default('http://agent-signer:3050'),
  SIGNER_HMAC_API: z.string().min(32),
  SOTER_ATTESTER_URL: z.string().url().default('http://soter-attester:3060'),
  ATTESTER_HMAC_API: z.string().min(32),
  AGENT_RUNNER_URL: z.string().url().default('http://agent-runner:3100'),
  INTERNAL_TOKEN_AGENT: z.string().min(32),
  MCP_URL: z.string().url().default('http://mcp:3080'),
  NOTIFIER_URL: z.string().url().default('http://notifier:3210'),
  PAYOUT_PARTNER_URL: z.string().url().default('http://payout-partner:3310'),
  OPERATOR_URL: z.string().url().default('http://operator:3020'),
  REGULATOR_URL: z.string().url().default('http://regulator:3020'),
  FISCO_RPC_URL: z.string().url(),
  FISCO_DEPLOYMENTS_FILE: z.string(),
  INTERNAL_TOKEN_API: z.string().min(32),
  PORT: z.coerce.number().int().default(3200),
}).parse(process.env);

const log = pino();
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient: pub } = baseClients(env.BASE_RPC_URL);
const conn = connect({ host: env.MYSQL_HOST, user: 'api', password: env.MYSQL_PASSWORD_API, database: 'api' });
await migrate(conn.runner, loadMigrations('api'));
const store = new MySqlApiStore(conn.runner);
const c = clients({
  bundlerUrl: env.BUNDLER_URL, bundlerToken: env.INTERNAL_TOKEN_BUNDLER, bankUrl: env.BANK_URL, membersToken: env.INTERNAL_TOKEN_MEMBERS,
  signerUrl: env.AGENT_SIGNER_URL, signerSecret: env.SIGNER_HMAC_API, attesterUrl: env.SOTER_ATTESTER_URL, attesterSecret: env.ATTESTER_HMAC_API,
  runnerUrl: env.AGENT_RUNNER_URL, runnerToken: env.INTERNAL_TOKEN_AGENT, mcpUrl: env.MCP_URL, mcpToken: env.INTERNAL_TOKEN_API,
});

const now = () => baseNow(pub);
const userOf = async (account: Address) => {
  const u = await store.userByAccount(account);
  if (!u?.account) throw new Error('unknown account');
  const [p] = await store.passkeysOf(u.id);
  if (!p) throw new Error('no passkey');
  return { u, p };
};
const credIdHashOf = async (account: Address) => (await userOf(account)).p.credIdHash as Hex;
const accountModules = (p: { credIdHash: Hex; x: bigint; y: bigint }) => ({ ...d, credIdHash: p.credIdHash, x: p.x, y: p.y });

const ownerActions = new OwnerActions({ domain: { name: d.domainName, hook: d.mandateHook }, now, credIdHashOf, bank: c.bank, bundler: c.bundler });
const onboarding = new Onboarding({
  user: async (account) => {
    const { u, p } = await userOf(account);
    return { userId: u.id, account, credIdHash: p.credIdHash as Hex };
  },
  isDeployed: async (account) => ((await pub.getCode({ address: account })) ?? '0x') !== '0x',
  firstOp: async (account) => {
    const { u, p } = await userOf(account);
    const prep = await prepareAccount(pub as never, accountModules({ credIdHash: p.credIdHash as Hex, x: BigInt(p.x), y: BigInt(p.y) }), BigInt(u.saltNonce!));
    return { factory: prep.factory, factoryData: prep.factoryData, callData: prep.callData };
  },
  now, c,
});
const notify = async (n: { account: Address; kind: string; text: string; link?: string }) => {
  await fetch(`${env.NOTIFIER_URL}/notify`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_API}` }, body: JSON.stringify(n), signal: AbortSignal.timeout(5000) });
};
const approvals = new Approvals({
  publicUrl: env.PUBLIC_URL,
  notify,
  store: new MySqlApprovalStore(conn.runner), domain: { name: d.domainName, hook: d.mandateHook }, now, credIdHashOf, bundler: c.bundler, attester: c.attester,
  resubmit: async (account, calls) => {
    const r = await fetch(`${env.MCP_URL}/internal/resubmit`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_API}` },
      body: JSON.stringify({ account, calls }, (_, x) => (typeof x === 'bigint' ? x.toString() : x)),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; txHash?: Hex };
    return { success: r.ok && j.success === true, txHash: j.txHash ?? null };
  },
});
const link = new WechatLink({ ownerActions, publicUrl: env.PUBLIC_URL, attester: c.attester });
async function standingOrdersDirectory(): Promise<Directory> {
  const r = await fetch(`${env.PAYOUT_PARTNER_URL}/merchants`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`payout partner: ${r.status}`);
  return r.json() as Promise<Directory>;
}
const ORDER_SET = parseAbiItem('event StandingOrderSet(address indexed account, uint32 indexed id, bytes32 orderHash)');
const standingOrders = new StandingOrders({
  now, ownerActions, standingOrders: d.standingOrders, proposals: new MySqlProposalStore(conn.runner), bundler: c.bundler, notify,
  orders: async (account) => {
    const logs = await pub.getLogs({ address: d.standingOrders, event: ORDER_SET, args: { account }, fromBlock: BigInt(d.deployBlock), toBlock: 'latest' });
    const ids = [...new Set(logs.map((l) => Number(l.args.id)))];
    return Promise.all(ids.map(async (id) => {
      const [payee, amount, period, , nextDue, rail, merchantRef, active] = await pub.readContract({ address: d.standingOrders, abi: StandingOrdersAbi, functionName: 'orders', args: [account, id] });
      return { id, payee, amount, period: Number(period), nextDue: BigInt(nextDue), rail: Number(rail), merchantRef, active };
    }));
  },
  directory: () => standingOrdersDirectory(),
});

// F8: the operator's entries, the FISCO AuditLog and the Base Anchor, three independent sources.
const fiscoPub = fiscoClients(env.FISCO_RPC_URL).pub;
const auditLog = (JSON.parse(readFileSync(env.FISCO_DEPLOYMENTS_FILE, 'utf8')) as { auditLog: Address }).auditLog;
const audit = new Audit({
  entries: async (from, limit, account) => {
    const r = await fetch(`${env.OPERATOR_URL}/audit/entries?from=${from}&limit=${limit}${account ? `&account=${account}` : ''}`, { headers: { authorization: `Bearer ${env.INTERNAL_TOKEN_MEMBERS}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`operator audit entries: ${r.status}`);
    return ((await r.json()) as { entries: AuditRow[] }).entries;
  },
  fisco: {
    latest: async () => { const [seq, head] = (await fiscoPub.readContract({ address: auditLog, abi: AuditLogAbi, functionName: 'latest' })) as readonly [bigint, Hex]; return { seq, head }; },
    headAt: async (seq) => (await fiscoPub.readContract({ address: auditLog, abi: AuditLogAbi, functionName: 'headAt', args: [seq] })) as Hex,
  },
  anchor: { latest: async () => { const [seq, head, fiscoBlock] = await pub.readContract({ address: d.anchor, abi: AnchorAbi, functionName: 'latest' }); return { seq, head, fiscoBlock }; } },
});
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const PAYOUT_REQUESTED = parseAbiItem('event PayoutRequested(uint256 indexed id, address indexed account, address indexed partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)');
const statement = async (account: Address, fromMs: number, toMs: number) => {
  const range = { fromBlock: BigInt(d.deployBlock), toBlock: 'latest' as const };
  const [out, inc, payouts, balance] = await Promise.all([
    pub.getLogs({ address: d.usdc, event: TRANSFER, args: { from: account }, ...range }),
    pub.getLogs({ address: d.usdc, event: TRANSFER, args: { to: account }, ...range }),
    pub.getLogs({ address: d.payoutRail, event: PAYOUT_REQUESTED, args: { account }, ...range }),
    pub.readContract({ address: d.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
  ]);
  const times = new Map<bigint, number>();
  for (const b of new Set([...out, ...inc].map((l) => l.blockNumber!))) times.set(b, Number((await pub.getBlock({ blockNumber: b })).timestamp) * 1000);
  const dir = await standingOrdersDirectory().catch(() => null);
  const names = Object.fromEntries(payouts.map((l) => [l.transactionHash!.toLowerCase(), dir?.merchants.find((m) => m.merchantRef.toLowerCase() === l.args.merchantRef!.toLowerCase())?.name ?? 'Payout partner']));
  const all = statementEntries([...out, ...inc].map((l) => ({ txHash: l.transactionHash!, at: times.get(l.blockNumber!)!, from: l.args.from!, to: l.args.to!, value: l.args.value! })),
    { account, desk: d.treasuryDesk, payoutRail: d.payoutRail, payouts: names });
  const xml = camt053({
    account, entries: all.filter((e) => e.at >= fromMs && e.at <= toMs), from: fromMs, to: toMs,
    opening: balanceAt(all, balance, fromMs), closing: balanceAt(all, balance, toMs), now: Date.now(), network: 'Base Sepolia', chainId: d.chainId,
  });
  const errors = await camtErrors(xml);
  if (errors.length) throw new Error(`camt.053 does not validate: ${errors[0]}`);
  return xml;
};

// The owner's views (chain reads) and the console's relay to the member services (staff sessions required for writes).
const reader = accountReader(pub as never, d);
const views = new Views({ reader, tokens: { usdc: d.usdc, txau: d.txau, txag: d.txag } });
const config = { chainId: d.chainId, domainName: d.domainName, mandateHook: d.mandateHook, usdc: d.usdc, txau: d.txau, txag: d.txag, deskSpreadBps: 30 };
const MEMBERS = { bank: env.BANK_URL, regulator: env.REGULATOR_URL, operator: env.OPERATOR_URL } as const;
const member: MemberCall = async (role, method, path, body, session) => {
  const r = await fetch(`${MEMBERS[role]}${path}`, {
    method, signal: AbortSignal.timeout(60_000), body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_MEMBERS}`, ...(session ? { 'x-staff-session': session } : {}) },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const agents = async () => {
  const r = await fetch(`${env.BUNDLER_URL}/accounts`, { headers: { authorization: `Bearer ${env.INTERNAL_TOKEN_BUNDLER}` } });
  const { accounts } = (await r.json()) as { accounts: Address[] };
  // Onboarded accounts (a KYA on Base), newest first.
  const rows = await Promise.all(accounts.slice(-200).reverse().map(async (account) => {
    const [s, a] = await Promise.all([views.status(account), views.agent(account)]);
    return { account, status: s.effective, heartbeatValidUntil: s.heartbeatValidUntil, ...a };
  }));
  return rows.filter((r) => r.agentKey !== '0x0000000000000000000000000000000000000000').slice(0, 50);
};

const app = createApiApp({
  store, sessionSecret: env.SESSION_SECRET, rpId: env.PUBLIC_HOST, origin: env.PUBLIC_URL,
  accountFor: async (p, salt) => ({ address: (await prepareAccount(pub as never, accountModules(p), salt)).address }),
  extend: (r, h, session) => apiRoutes(r, h, session, {
    onboarding, ownerActions, approvals, link, standingOrders, audit, statement, views, config, bank: c.bank, runner: c.runner,
    chainNowMs: async () => Number(await now()) * 1000,
    labels: async (account, labels) => {
      const r = await c.mcp.setLabels(account, labels);
      if (r.status !== 204) throw new UpstreamError('mcp', r.status, await r.text());
    },
    agentKeyOf: async (account) => (await pub.readContract({ address: d.mandateHook, abi: MandateHookAbi, functionName: 'kyaOf', args: [account] }))[0] as Address,
  }),
  mount: (a, h) => {
    const mp = express.Router();
    mpRoutes(mp, h, link);
    a.use('/mp', mp);
    const internal = express.Router();
    internal.use(express.json());
    internalRoutes(internal, h, env.INTERNAL_TOKEN_API, approvals, standingOrders);
    a.use('/internal', internal);
    const consoleRouter = express.Router();
    consoleRouter.use(express.json({ limit: '64kb' }));
    consoleRoutes(consoleRouter, { member, agents });
    a.use('/api/console', consoleRouter);
  },
});
app.listen(env.PORT, () => log.info({ port: env.PORT }, 'api listening'));
