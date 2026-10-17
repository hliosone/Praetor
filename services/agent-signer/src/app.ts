// agent-signer (spec 05): the agent keys live only here, derived inside the TEE per account and key version
// (dstack getKey("praetor/agent/<account>/v<n>", "agent", "secp256k1")). No route exports a key. Each route names its
// callers: sign-userop mcp only, sign-weid bank only, address/attest api and bank.
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { concat, encodeFunctionData, getAddress, hexToBytes, isAddressEqual, keccak256, parseAbi, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ReplayGuard, verifyCaller } from '@praetor/protocol/caller-auth';
import { decodeExecute, fromJson, userOpHash, BASE_CHAIN_ID, ENTRY_POINT } from '@praetor/userop';
import { isOwnAuthentication } from './weid.js';

export type KeySource = {
  getKey(path: string): Promise<Hex>;
  quote(reportData: Uint8Array): Promise<{ quote: string }>;
  info(): Promise<{ appId: string; composeHash: string }>;
};

export type SignerDeps = {
  keys: KeySource;
  secrets: Partial<Record<'mcp' | 'api' | 'bank', string>>;
  /** From ATTESTATION_MODE only: nothing in a simulator quote says "simulator" (V5). */
  simulator: boolean;
  version: string;
  /** The only MCP endpoint an agent DID may advertise. */
  mcpUrl: string;
  rateLimitPerHour?: number;
  now?: () => number;
};

const FISCO_CHAIN_ID = 20200;
const UPDATE_WEID = parseAbi(['function updateWeId(address identity, string updated, string[] authentication, string[] service)']);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const keyVersion = z.coerce.number().int().min(1).max(1000);

export function createSignerApp(d: SignerDeps) {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const limit = d.rateLimitPerHour ?? 120;
  const replay = new ReplayGuard();
  const signed = new Map<string, number[]>();
  const secrets = Object.fromEntries(Object.entries(d.secrets).filter(([, v]) => !!v)) as Record<string, string>;

  const keyFor = async (account: string, v: number) => privateKeyToAccount(await d.keys.getKey(`praetor/agent/${account.toLowerCase()}/v${v}`));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Every /v1 route: caller HMAC over method, URL and exact body, accepted once.
  app.use('/v1', (req, res, next) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const caller = verifyCaller(req.headers as Record<string, string>, secrets, req.method, req.originalUrl, raw, now());
    if (!caller || !replay.once(String(req.headers['x-praetor-signature']), now())) return res.status(401).json({ error: 'unauthorized' });
    res.locals.caller = caller;
    next();
  });
  const only = (...callers: string[]) => (_req: Request, res: Response, next: NextFunction) =>
    (callers.includes(res.locals.caller) ? next() : res.status(403).json({ error: 'forbidden' }));
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
  const accountParam = (req: Request) => getAddress(address.parse(req.params.account));

  app.get('/v1/info', h(async (_req, res) => {
    res.json({ ...(await d.keys.info()), simulator: d.simulator, version: d.version });
  }));

  app.get('/v1/agents/:account/address', only('api', 'bank'), h(async (req, res) => {
    res.json({ address: (await keyFor(accountParam(req), keyVersion.parse(req.query.v ?? 1))).address });
  }));

  app.post('/v1/agents/:account/attest', only('api', 'bank'), h(async (req, res) => {
    const b = z.object({ nonce: bytes32, keyVersion }).parse(req.body);
    const agent = await keyFor(accountParam(req), b.keyVersion);
    // getQuote takes the raw 32 bytes (a hex string would be read as UTF-8 text, V5).
    const { quote } = await d.keys.quote(hexToBytes(keccak256(concat([agent.address, b.nonce as Hex]))));
    res.json({ address: agent.address, quote });
  }));

  app.post('/v1/agents/:account/sign-userop', only('mcp'), h(async (req, res) => {
    const account = accountParam(req);
    const b = z.object({ userOp: z.unknown(), chainId: z.number().int(), entryPoint: address, keyVersion }).parse(req.body);
    if (b.chainId !== BASE_CHAIN_ID) throw new HttpError(400, 'unexpected chain');
    if (!isAddressEqual(b.entryPoint as Address, ENTRY_POINT)) throw new HttpError(400, 'unexpected entry point');
    const op = fromJson(b.userOp);
    if (!isAddressEqual(op.sender, account)) throw new HttpError(400, 'sender is not this account');
    let calls;
    try {
      calls = decodeExecute(op.callData).calls;
    } catch {
      throw new HttpError(400, 'callData is not execute');
    }
    if (calls.some((c) => isAddressEqual(c.to, account))) throw new HttpError(400, 'execute targets the account itself');
    const t = now();
    const recent = (signed.get(account) ?? []).filter((x) => t - x < 3600);
    if (recent.length >= limit) throw new HttpError(429, 'rate limit');
    signed.set(account, [...recent, t]);
    const agent = await keyFor(account, b.keyVersion);
    res.json({ signature: await agent.signMessage({ message: { raw: userOpHash(op, b.chainId) } }) });
  }));

  app.post('/v1/agents/:account/sign-weid', only('bank'), h(async (req, res) => {
    const account = accountParam(req);
    const b = z.object({ kind: z.enum(['createDid', 'addService']), keyVersion, fields: z.record(z.unknown()) }).parse(req.body);
    const agent = await keyFor(account, b.keyVersion);
    if (b.kind === 'createDid') {
      // createWeIdWithPubKey takes the uncompressed point without its 04 prefix, base64.
      return res.json({ address: agent.address, publicKeyECDSA: Buffer.from(agent.publicKey.slice(4), 'hex').toString('base64') });
    }
    const f = z.object({
      weIdContract: address, nonce: z.number().int().min(0), updated: z.string().regex(/^\d{1,13}$/),
      authentication: z.array(z.string().max(2048)).min(1).max(8), service: z.array(z.string().max(512)).max(16),
      add: z.array(z.object({ type: z.string(), endpoint: z.string().max(256) })).min(1).max(2),
    }).parse(b.fields);
    const weid = `did:weid:101:${agent.address.toLowerCase()}`;
    // Only the entry createWeIdWithPubKey wrote for this very key: anything else would hand the DID to someone else.
    if (!isOwnAuthentication(f.authentication, weid, agent.publicKey)) throw new HttpError(400, 'authentication is not exactly the agent key');
    for (const s of [...f.service.map((x) => ({ type: x.split(',')[1] ?? '', endpoint: x.split(',').slice(2).join(',') })), ...f.add]) {
      const ok = (s.type === 'AgentWallet' && s.endpoint === `eip155:${BASE_CHAIN_ID}:${account}`) || (s.type === 'MCP' && s.endpoint === d.mcpUrl) || s.type === 'WeIdentity';
      if (!ok) throw new HttpError(400, `service not allowed: ${s.type}`);
    }
    const added = f.add.map((s) => `${weid}#${keccak256(toHex(`${s.type},${s.endpoint}`)).slice(2, 10)},${s.type},${s.endpoint}`);
    const data = encodeFunctionData({ abi: UPDATE_WEID, functionName: 'updateWeId', args: [agent.address, f.updated, f.authentication, [...f.service, ...added]] });
    const rawTx = await agent.signTransaction({ type: 'legacy', chainId: FISCO_CHAIN_ID, to: f.weIdContract as Address, data, nonce: f.nonce, gas: 5_000_000n, gasPrice: 0n, value: 0n });
    res.json({ address: agent.address, rawTx });
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
