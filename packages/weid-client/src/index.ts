// WeIdentity client (spec 05, adapted from Alex's services/identity/weid-client.mjs): the REST service (custodial
// keys, no auth, Docker network only) and our weid-helper for what REST lacks. Every call checks errorCode: errors can
// come back with receipt status 1 (V3). "recognized" is trusted only after a read-back.

export class WeidError extends Error {
  constructor(readonly op: string, readonly code: number | undefined, message: string) {
    super(`weid ${op}: ${code ?? ''} ${message}`.replace(/\s+/g, ' ').trim());
  }
}

/** A WeIdentity CredentialPojo as the REST service and the SDK serialise it (fields we read are typed). */
export interface Credential {
  id: string;
  cptId: number;
  issuer: string;
  claim: Record<string, unknown>;
  proof: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Verification {
  valid: boolean;
  signature: boolean;
  revoked: boolean;
  evidence: boolean;
  hash?: string;
  signatureError?: string;
}

export interface WeidClientOptions {
  restUrl: string;
  helperUrl: string;
  /** REST key index of the admin key (default.passphrase of the REST service). */
  adminInvoker?: string;
  fetch?: typeof fetch;
}

const WEID = /^did:weid:101:0x[0-9a-fA-F]{40}$/;

export function weidClient(o: WeidClientOptions) {
  const f = o.fetch ?? fetch;
  const admin = o.adminInvoker ?? 'private_key';

  async function postJson(url: string, body: unknown): Promise<any> {
    const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  async function invoke<T = unknown>(functionName: string, functionArg: unknown = {}, invokerWeId?: string): Promise<T> {
    const j = await postJson(o.restUrl, { functionName, functionArg, transactionArg: invokerWeId ? { invokerWeId } : {}, v: '1.0.0' });
    if (j.errorCode !== 0) throw new WeidError(functionName, j.errorCode, j.errorMessage ?? 'failed');
    return j.respBody as T;
  }

  async function helper<T = any>(path: string, body: unknown): Promise<T> {
    const j = await postJson(`${o.helperUrl}${path}`, body);
    if (j.error !== undefined && j.error !== null) throw new WeidError(path, j.errorCode, String(j.error));
    return j as T;
  }

  const weId = (op: string, v: unknown): string => {
    if (typeof v !== 'string' || !WEID.test(v)) throw new WeidError(op, undefined, `unexpected WeID ${String(v)}`);
    return v;
  };

  return {
    invoke,
    createWeId: async () => weId('createWeId', await invoke('createWeId', {})),
    /** WeID for a key held elsewhere (the agent's TEE key); the admin pays the gas. */
    createWeIdWithPubKey: async (publicKeyECDSA: string) => weId('createWeIdWithPubKey', await invoke('createWeIdWithPubKey', { publicKeyECDSA }, admin)),
    getWeIdDocument: (w: string) => invoke<Record<string, unknown>>('getWeIdDocument', { weId: w }),

    async ensureRecognizedIssuer(w: string, name: string): Promise<void> {
      // Registration is open and names are unique: a rerun finds its own name taken, the read-back decides.
      await invoke('registerAuthorityIssuer', { weId: w, name }, admin).catch((e) => {
        if (!(e instanceof WeidError)) throw e;
      });
      await invoke('recognizeAuthorityIssuer', { weId: w }, admin).catch((e) => {
        if (!(e instanceof WeidError)) throw e;
      });
      const q = await invoke<{ recognized?: boolean }>('queryAuthorityIssuer', { weId: w });
      if (q?.recognized !== true) throw new WeidError('ensureRecognizedIssuer', undefined, `${w} not recognized`);
    },

    async registerCpt(owner: string, schema: Record<string, unknown>): Promise<number> {
      const r = await invoke<{ cptId: number }>('registerCpt', { weId: owner, cptJsonSchema: schema }, owner);
      if (!Number.isInteger(r?.cptId)) throw new WeidError('registerCpt', undefined, 'no cptId');
      return r.cptId;
    },

    /** Signed by the issuer's hosted key (REST is custodial). */
    createCredential: (a: { cptId: number; issuer: string; expiresAt: Date; claim: Record<string, unknown> }) =>
      invoke<Credential>('createCredentialPojo', {
        cptId: a.cptId,
        issuer: a.issuer,
        expirationDate: a.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        claim: a.claim,
      }, a.issuer),

    issuerSetup: (bankWeId: string) => helper<{ authorityIssuer: boolean; kycProvider: boolean }>('/issuers/setup', { bankWeId }),
    countersign: async (credential: Credential, signerWeId: string) => {
      const r = await helper<{ credential: Credential; hash: string }>('/credentials/countersign', { credential, signerWeId });
      return { credential: r.credential, hash: r.hash };
    },
    async verify(credential: Credential, issuerWeId: string): Promise<Verification> {
      const r = await helper<Partial<Verification>>('/credentials/verify', { credential, issuerWeId });
      return { valid: r.valid === true, signature: r.signature === true, revoked: r.revoked === true, evidence: r.evidence === true, hash: r.hash, signatureError: r.signatureError };
    },
    selective: async (credential: Credential, fields: string[]) =>
      (await helper<{ credential: Credential }>('/credentials/selective', { credential, fields })).credential,
    createEvidence: async (credential: Credential, signerWeId: string) =>
      (await helper<{ hash: string }>('/evidence/create', { credential, signerWeId })).hash,
    getEvidence: (hash: string) => helper<{ found: boolean; evidence?: Record<string, unknown> }>('/evidence/get', { hash }),
    async revoke(credential: Credential, signerWeId: string): Promise<void> {
      const j = await postJson(`${o.helperUrl}/evidence/revoke`, { credential, signerWeId });
      if (j.revoked !== true) throw new WeidError('revoke', j.errorCode, String(j.error ?? 'not revoked'));
    },
  };
}

export type WeidClient = ReturnType<typeof weidClient>;
