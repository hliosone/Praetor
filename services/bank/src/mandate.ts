// AgentMandate (spec 05, F1 step 11): the user's WeID key is custodial (REST), so its signature alone proves no consent.
// The bank prepares the user-signed inner credential, the user's passkey registered on the account signs a challenge
// over that exact credential, and only then does the bank countersign it and record its evidence (revocable as a whole).
import { randomUUID } from 'node:crypto';
import { getAddress, keccak256, toHex, type Hex } from 'viem';
import { verifyAssertion, type Assertion } from '@praetor/member-kit';
import type { Credential } from '@praetor/weid-client';
import { Refused, type BankIdentity, type KycRecord } from './kyc.js';

export const MANDATE_SCOPES = ['rebalance', 'pay', 'standing_orders'] as const;

export type MandateDraftInput = { userRef: string; account: string; agentKey: string; scopes: string[]; mandateHash: string; agentMeasurement: string };
export type MandateDraft = { id: string; userRef: string; account: string; inner: string; challenge: Hex; state: 'pending' | 'signed' };

export interface MandateStore {
  put(d: MandateDraft): Promise<void>;
  get(id: string): Promise<MandateDraft | undefined>;
  /** pending -> signed, once. */
  markSigned(id: string): Promise<boolean>;
}

export class MemoryMandateStore implements MandateStore {
  drafts = new Map<string, MandateDraft>();
  async put(d: MandateDraft) { this.drafts.set(d.id, { ...d }); }
  async get(id: string) { return this.drafts.get(id); }
  async markSigned(id: string) {
    const d = this.drafts.get(id);
    if (!d || d.state !== 'pending') return false;
    d.state = 'signed';
    return true;
  }
}

export type MandateDeps = {
  store: MandateStore;
  kycRecord: (userRef: string) => Promise<KycRecord | undefined>;
  identity: () => Promise<BankIdentity>;
  /** The passkey registered for this account on Base (PasskeyValidator.ownerKey), or null. */
  passkeyOf: (account: string, credIdHash: Hex) => Promise<{ x: bigint; y: bigint } | null>;
  weid: {
    createCredential(a: { cptId: number; issuer: string; expiresAt: Date; claim: Record<string, unknown> }): Promise<Credential>;
    countersign(c: Credential, signerWeId: string): Promise<{ credential: Credential; hash: string }>;
    createEvidence(c: Credential, signerWeId: string): Promise<string>;
  };
  rpId: string;
  origin: string;
  now?: () => Date;
};

const MANDATE_DAYS = 90;

export class MandateService {
  constructor(private readonly d: MandateDeps) {}

  async prepare(i: MandateDraftInput) {
    const r = await this.d.kycRecord(i.userRef);
    if (!r || r.state !== 'issued' || !r.userWeId || !r.riskProfile) throw new Refused('no issued PersonKYC for this user');
    if (r.account.toLowerCase() !== i.account.toLowerCase()) throw new Refused('mandate account differs from the KYC account');
    if (i.scopes.length === 0 || i.scopes.some((s) => !(MANDATE_SCOPES as readonly string[]).includes(s))) throw new Refused('unknown scope');
    const { mandateCpt } = await this.d.identity();
    const claim = {
      principal: r.userWeId, wallet: `eip155:84532:${getAddress(i.account)}`, agentKey: i.agentKey, scopes: i.scopes,
      mandateHash: i.mandateHash, riskProfile: r.riskProfile, agentMeasurement: i.agentMeasurement,
    };
    const now = this.d.now?.() ?? new Date();
    const inner = await this.d.weid.createCredential({ cptId: mandateCpt, issuer: r.userWeId, expiresAt: new Date(now.getTime() + MANDATE_DAYS * 86400_000), claim });
    const json = JSON.stringify(inner);
    const draft: MandateDraft = { id: randomUUID(), userRef: i.userRef, account: i.account, inner: json, challenge: keccak256(toHex(json)), state: 'pending' };
    await this.d.store.put(draft);
    return { draftId: draft.id, challenge: draft.challenge, claim };
  }

  async sign(draftId: string, assertion: Assertion) {
    const draft = await this.d.store.get(draftId);
    if (!draft) throw new Refused('unknown draft');
    if (draft.state !== 'pending') throw new Refused('draft not pending');
    const key = await this.d.passkeyOf(draft.account, assertion.credentialId);
    if (!key) throw new Refused('passkey not registered on this account');
    try {
      verifyAssertion(key, assertion, { challenge: draft.challenge, rpId: this.d.rpId, origin: this.d.origin });
    } catch (e) {
      throw new Refused(`passkey assertion refused: ${(e as Error).message}`);
    }
    if (!(await this.d.store.markSigned(draftId))) throw new Refused('draft not pending');
    const { bankWeId } = await this.d.identity();
    const { credential } = await this.d.weid.countersign(JSON.parse(draft.inner) as Credential, bankWeId);
    const mandateCredentialHash = await this.d.weid.createEvidence(credential, bankWeId) as Hex;
    const claim = (JSON.parse(draft.inner) as Credential).claim as { agentKey: string; agentMeasurement: Hex };
    return { credential, mandateCredentialHash, account: draft.account, agentKey: claim.agentKey, agentMeasurement: claim.agentMeasurement };
  }
}
