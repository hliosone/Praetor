// soter-attester (spec 05): turns a WeChat SOTER result (Face ID / fingerprint on the user's phone, verified by
// Tencent) into a SoterApproval the hook accepts, signed by a key that exists only in this TEE. The device result must
// sign exactly the digest the user approves; never logs openid, uid, cpu_id or resultJSON.
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { concat, hexToBytes, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ReplayGuard, verifyCaller } from '@praetor/protocol/caller-auth';
import { bindingHash, digest, praetorDomain } from '@praetor/protocol';
import { tencentClient, TencentError, type TencentConfig } from './tencent.js';

export type KeySource = {
  getKey(path: string): Promise<Hex>;
  quote(reportData: Uint8Array): Promise<{ quote: string }>;
  info(): Promise<{ appId: string; composeHash: string }>;
};

export type AttesterDeps = {
  keys: KeySource;
  secrets: { api?: string };
  simulator: boolean;
  version: string;
  tencent: TencentConfig;
  /** The EIP-712 domain of the hook this attester signs for. */
  domain: { name: string; hook: Address };
  now?: () => number;
};

const MAX_EXPIRY_S = 3600;
const KEY_PATH = 'praetor/soter-attester/v1';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createAttesterApp(d: AttesterDeps) {
  const now = d.now ?? (() => Math.floor(Date.now() / 1000));
  const replay = new ReplayGuard();
  const tencent = tencentClient(d.tencent);
  const secrets: Record<string, string> = d.secrets.api ? { api: d.secrets.api } : {};
  const attester = async () => privateKeyToAccount(await d.keys.getKey(KEY_PATH));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb', verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = buf; } }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/v1', (req, res, next) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const caller = verifyCaller(req.headers as Record<string, string>, secrets, req.method, req.originalUrl, raw, now());
    if (!caller || !replay.once(String(req.headers['x-praetor-signature']), now())) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

  app.get('/v1/info', h(async (_req, res) => {
    res.json({ attester: (await attester()).address, ...(await d.keys.info()), simulator: d.simulator, version: d.version });
  }));

  app.post('/v1/attest', h(async (req, res) => {
    const { nonce } = z.object({ nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body);
    const a = await attester();
    res.json({ attester: a.address, quote: (await d.keys.quote(hexToBytes(keccak256(concat([a.address, nonce as Hex]))))).quote });
  }));

  app.post('/v1/soter/approve', h(async (req, res) => {
    const b = z.object({
      code: z.string().min(1).max(128), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), digestHex: z.string().regex(/^[0-9a-f]{64}$/),
      expiresAt: z.number().int(), authMode: z.enum(['facial', 'fingerPrint', 'speech']), resultJSON: z.string().min(2).max(4096), resultJSONSignature: z.string().min(1).max(2048),
    }).parse(req.body);
    const t = now();
    if (b.expiresAt <= t || b.expiresAt > t + MAX_EXPIRY_S) throw new HttpError(400, 'expiresAt must be within the next hour');
    const openid = await tencent.openid(b.code);
    if (!(await tencent.verifySignature(openid, b.resultJSON, b.resultJSONSignature, t))) throw new HttpError(403, 'SOTER signature not verified by Tencent');
    // Read by field name: the signed JSON's raw field must be the very digest being approved.
    let r: { raw?: unknown; counter?: unknown; uid?: unknown; cpu_id?: unknown };
    try {
      r = JSON.parse(b.resultJSON);
    } catch {
      throw new HttpError(400, 'resultJSON is not JSON');
    }
    if (r.raw !== b.digestHex) throw new HttpError(403, 'the SOTER result signs another challenge');
    if (!Number.isSafeInteger(r.counter) || (r.counter as number) < 0 || typeof r.uid !== 'string' || typeof r.cpu_id !== 'string') throw new HttpError(400, 'resultJSON fields missing');
    const soterApproval = {
      account: b.account as Address, digest: `0x${b.digestHex}` as Hex,
      bindingHash: bindingHash({ mpAppId: d.tencent.appId, openid, uid: r.uid, cpuId: r.cpu_id }),
      soterCounter: BigInt(r.counter as number), expiresAt: BigInt(b.expiresAt),
    };
    const a = await attester();
    const attesterSig = await a.sign({ hash: digest(praetorDomain(d.domain.name, d.domain.hook), 'SoterApproval', soterApproval) });
    res.json({ soterApproval: { ...soterApproval, soterCounter: soterApproval.soterCounter.toString(), expiresAt: soterApproval.expiresAt.toString() }, attesterSig });
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'BadRequest' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof TencentError) return res.status(403).json({ error: 'WeChat refused the request' });
    res.status(500).json({ error: 'Internal' });
  });
  return app;
}
