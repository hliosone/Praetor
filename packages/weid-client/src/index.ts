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

/** CPT schemas (spec 05). PersonKYC also names its holder (the user's WeID), so the credential is bound to a person (D28). */
export const PERSON_KYC_CPT = {
  title: 'PersonKYC',
  description: 'KYC attestation issued by the bank',
  type: 'object',
  properties: {
    holder: { type: 'string', description: 'WeID of the person' },
    ageOver18: { type: 'boolean' },
    jurisdiction: { type: 'string', pattern: '^[A-Z]{2}$' },
    riskProfile: { type: 'string', enum: ['conservative', 'balanced', 'growth'] },
    sanctionsScreened: { type: 'string', description: 'date of the last sanctions screening (YYYY-MM-DD)' },
    kycLevel: { type: 'integer', minimum: 0 },
  },
  required: ['holder', 'ageOver18', 'jurisdiction', 'riskProfile', 'sanctionsScreened', 'kycLevel'],
} as const;

export const AGENT_MANDATE_CPT = {
  title: 'AgentMandate',
  description: 'Mandate from a principal to an AI agent wallet',
  type: 'object',
  properties: {
    principal: { type: 'string', description: 'WeID of the principal (user)' },
    wallet: { type: 'string', description: 'CAIP-10 account, eip155:84532:0x...' },
    agentKey: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
    scopes: { type: 'array', items: { type: 'string' } },
    mandateHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
    riskProfile: { type: 'string' },
    agentMeasurement: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
  },
  required: ['principal', 'wallet', 'agentKey', 'scopes', 'mandateHash', 'riskProfile', 'agentMeasurement'],
} as const;

const INVALID: Verification = { valid: false, signature: false, revoked: false, evidence: false };

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

  async function verify(credential: Credential, issuerWeId: string, extra: { evidenceHash?: string; signatureOnly?: true } = {}): Promise<Verification> {
    const r = await helper<Partial<Verification>>('/credentials/verify', { credential, issuerWeId, ...extra });
    return { valid: r.valid === true, signature: r.signature === true, revoked: r.revoked === true, evidence: r.evidence === true, hash: r.hash, signatureError: r.signatureError };
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

    contracts: () => helper<{ weId: string; cpt?: string; authorityIssuer?: string; evidence?: string; specificIssuer?: string }>('/contracts', {}),
    issuerSetup: (bankWeId: string) => helper<{ authorityIssuer: boolean; kycProvider: boolean }>('/issuers/setup', { bankWeId }),
    countersign: async (credential: Credential, signerWeId: string) => {
      const r = await helper<{ credential: Credential; hash: string }>('/credentials/countersign', { credential, signerWeId });
      return { credential: r.credential, hash: r.hash };
    },
    verify,
    /** A credential the bank (or another pinned issuer) issued under a pinned CPT: never trusts the credential's own
     *  issuer field. evidenceHash: the full credential's evidence, for a selective-disclosure copy. */
    async verifyIssued(credential: Credential, pin: { issuer: string; cptId: number; evidenceHash?: string }): Promise<Verification> {
      if (credential.issuer !== pin.issuer || credential.cptId !== pin.cptId) return INVALID;
      return verify(credential, pin.issuer, pin.evidenceHash ? { evidenceHash: pin.evidenceHash } : {});
    },
    /** AgentMandate: outer credential countersigned by the bank (evidence, so revocable), wrapping exactly one inner
     *  credential of the AgentMandate CPT signed by the principal and naming the principal. */
    async verifyMandate(outer: Credential, pin: { bank: string; principal: string; cptId: number }): Promise<Verification> {
      const list = (outer.claim as { credentialList?: Credential[] }).credentialList;
      const inner = Array.isArray(list) && list.length === 1 ? list[0]! : undefined;
      if (outer.issuer !== pin.bank || !inner || inner.issuer !== pin.principal || inner.cptId !== pin.cptId || inner.claim?.principal !== pin.principal) return INVALID;
      const o = await verify(outer, pin.bank);
      if (!o.valid) return o;
      const i = await verify(inner, pin.principal, { signatureOnly: true });
      return i.signature ? o : { ...o, valid: false, signature: false, signatureError: i.signatureError };
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
