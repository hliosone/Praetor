// api entrypoint (spec 05): config from env, its own database, clients of the internal services, the HTTP app.
import express from 'express';
import pino from 'pino';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import { MandateHookAbi, baseClients, baseNow, loadDeployments } from '@praetor/chain';
import { connect, loadMigrations, migrate } from '@praetor/db';
import { prepareAccount } from '@praetor/userop';
import { createApiApp } from './app.js';
import { clients } from './clients.js';
import { MySqlApiStore, MySqlApprovalStore } from './mysql.js';
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
const approvals = new Approvals({
  publicUrl: env.PUBLIC_URL,
  notify: async (n) => {
    await fetch(`${env.NOTIFIER_URL}/notify`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_API}` }, body: JSON.stringify(n), signal: AbortSignal.timeout(5000) });
  },
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

const app = createApiApp({
  store, sessionSecret: env.SESSION_SECRET, rpId: env.PUBLIC_HOST, origin: env.PUBLIC_URL,
  accountFor: async (p, salt) => ({ address: (await prepareAccount(pub as never, accountModules(p), salt)).address }),
  extend: (r, h, session) => apiRoutes(r, h, session, {
    onboarding, ownerActions, approvals, link, bank: c.bank, runner: c.runner,
    agentKeyOf: async (account) => (await pub.readContract({ address: d.mandateHook, abi: MandateHookAbi, functionName: 'kyaOf', args: [account] }))[0] as Address,
  }),
  mount: (a, h) => {
    const mp = express.Router();
    mpRoutes(mp, h, link);
    a.use('/mp', mp);
    const internal = express.Router();
    internal.use(express.json());
    internalRoutes(internal, h, env.INTERNAL_TOKEN_API, approvals);
    a.use('/internal', internal);
  },
});
app.listen(env.PORT, () => log.info({ port: env.PORT }, 'api listening'));
