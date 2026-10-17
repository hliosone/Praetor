// The KYA attestation (spec 05, F1 steps 8 to 12) is built by the bank from what it verified itself: the KYC record
// bound to the account (level, risk profile, jurisdiction, PersonKYC evidence hash), the agent-signer quote (agent
// key, measurement) and the AgentMandate it countersigned for that same key and measurement. Nothing comes from the
// caller but the agent DID hash and the validity.
import type { Hex } from 'viem';
import { RiskProfile } from '@praetor/protocol';
import { Refused, type KycRecord } from './kyc.js';

const PROFILE: Record<string, number> = { conservative: RiskProfile.CONSERVATIVE, balanced: RiskProfile.BALANCED, growth: RiskProfile.GROWTH };

export type SignedMandate = { agentKey: string; agentMeasurement: Hex; credentialHash: Hex };

export class KyaBuilder {
  private quotes = new Map<string, { agentKey: string; measurement: Hex }>();
  private mandates = new Map<string, SignedMandate>();

  constructor(private readonly d: { recordOf(account: string): Promise<KycRecord | undefined> }) {}

  quoteVerified(account: string, agentKey: string, measurement: Hex) {
    this.quotes.set(account.toLowerCase(), { agentKey: agentKey.toLowerCase(), measurement });
  }

  /** What an AgentMandate draft for this agent key must carry as agentMeasurement. */
  measurementFor(account: string, agentKey: string): Hex {
    const q = this.quotes.get(account.toLowerCase());
    if (!q || q.agentKey !== agentKey.toLowerCase()) throw new Refused('no verified agent-signer quote for this agent key');
    return q.measurement;
  }

  mandateSigned(account: string, m: SignedMandate) {
    this.mandates.set(account.toLowerCase(), m);
  }

  async build(account: string, a: { agentDidHash: Hex; validUntil: bigint }) {
    const r = await this.d.recordOf(account);
    if (!r || r.state !== 'issued' || !r.credentialHash || !r.riskProfile || !r.jurisdiction || r.kycLevel === undefined) throw new Refused('no issued PersonKYC for this account');
    const q = this.quotes.get(account.toLowerCase());
    if (!q) throw new Refused('no verified agent-signer quote for this account');
    const m = this.mandates.get(account.toLowerCase());
    if (!m || m.agentKey.toLowerCase() !== q.agentKey || m.agentMeasurement.toLowerCase() !== q.measurement.toLowerCase()) throw new Refused('no countersigned mandate (AgentMandate) for the quoted agent key and measurement');
    return {
      account, agentKey: q.agentKey, agentDidHash: a.agentDidHash, kycCredentialHash: r.credentialHash as Hex, mandateCredentialHash: m.credentialHash,
      kycLevel: r.kycLevel, riskProfile: PROFILE[r.riskProfile]!, jurisdiction: r.jurisdiction, agentMeasurement: q.measurement, validUntil: a.validUntil,
    };
  }
}
