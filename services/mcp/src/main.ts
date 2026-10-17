// mcp entrypoint (spec 05): config from env, its own database, the MCP app on the Docker networks.
import pino from 'pino';
import { z } from 'zod';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { MandateHookAbi, StandingOrdersAbi, baseClients, baseNow, loadDeployments } from '@praetor/chain';
import { connect, loadMigrations, migrate } from '@praetor/db';
import { createMcpApp } from './app.js';
import { apiApprovals, apiProposals, chainReader, dbLabels, submitter } from './ports.js';
import { MySqlTokenStore } from './store.js';
import { oauthRouter } from './oauth.js';
import { MySqlOAuthStore } from './oauth-store.js';
import type { Ports } from './tools.js';

const env = z.object({
  BASE_RPC_URL: z.string().url(),
  DEPLOYMENTS_FILE: z.string(),
  MYSQL_HOST: z.string().default('mysql'),
  MYSQL_PASSWORD_MCP: z.string().min(1),
  BUNDLER_URL: z.string().url().default('http://bundler:3010'),
  INTERNAL_TOKEN_BUNDLER: z.string().min(32),
  AGENT_SIGNER_URL: z.string().url().default('http://agent-signer:3050'),
  SIGNER_HMAC_MCP: z.string().min(32),
  INTERNAL_TOKEN_MCP: z.string().min(32),
  INTERNAL_TOKEN_API: z.string().min(32),
  API_URL: z.string().url().optional(),
  AGENT_SUBNET: z.string().default('10.90.0.0/24'),
  PUBLIC_URL: z.string().url().default('https://praetor.localhost'),
  SESSION_SECRET: z.string().min(32),
  EXPLORER_URL: z.string().url().default('https://sepolia.basescan.org'),
  PORT: z.coerce.number().int().default(3080),
}).parse(process.env);

const log = pino();
const d = loadDeployments(env.DEPLOYMENTS_FILE);
const { publicClient } = baseClients(env.BASE_RPC_URL);
const conn = connect({ host: env.MYSQL_HOST, user: 'mcp', password: env.MYSQL_PASSWORD_MCP, database: 'mcp' });
await migrate(conn.runner, loadMigrations('mcp'));
const tokens = new MySqlTokenStore(conn.runner);

const bundlerTx = async (to: Address, data: Hex) => {
  const r = await fetch(`${env.BUNDLER_URL}/tx`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_BUNDLER}` }, body: JSON.stringify({ to, data }) });
  const j = (await r.json().catch(() => ({}))) as { txHash?: Hex; success?: boolean };
  return { txHash: j.txHash ?? null, success: r.ok && j.success === true };
};
const reader = chainReader(publicClient as never, d);
const ports: Ports = {
  tokens: { usdc: d.usdc, txau: d.txau, txag: d.txag, desk: d.treasuryDesk },
  explorer: env.EXPLORER_URL,
  reader,
  submit: submitter({ bundlerUrl: env.BUNDLER_URL, bundlerToken: env.INTERNAL_TOKEN_BUNDLER, signerUrl: env.AGENT_SIGNER_URL, signerSecret: env.SIGNER_HMAC_MCP, agentKeyOf: async (a) => (await reader.kya(a)).agentKey }),
  approvals: apiApprovals(env.API_URL, env.INTERNAL_TOKEN_API),
  proposals: apiProposals(env.API_URL, env.INTERNAL_TOKEN_API),
  labels: dbLabels(conn.runner),
  standingOrders: { execute: (account, id) => bundlerTx(d.standingOrders, encodeFunctionData({ abi: StandingOrdersAbi, functionName: 'execute', args: [account, id] })) },
};

const app = createMcpApp({
  tokens, ports: () => ports, internalToken: env.INTERNAL_TOKEN_MCP, apiToken: env.INTERNAL_TOKEN_API, agentSubnet: env.AGENT_SUBNET, baseUrl: env.PUBLIC_URL,
  extra: (a) => a.use(oauthRouter({ store: new MySqlOAuthStore(conn.runner), baseUrl: env.PUBLIC_URL, webOrigin: env.PUBLIC_URL, secret: env.SESSION_SECRET })),
  liveApproval: async (account, callHash) => {
    const [expiresAt, consumed] = (await publicClient.readContract({ address: d.mandateHook, abi: MandateHookAbi, functionName: 'approvalOf', args: [account, callHash] })) as readonly [bigint, boolean];
    return !consumed && expiresAt > (await baseNow(publicClient as never));
  },
});
app.listen(env.PORT, () => log.info({ port: env.PORT }, 'mcp listening'));
