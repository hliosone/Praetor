// The bank's WeIdentity setup, once per chain: its WeID (hosted by weid-rest), recognized Authority Issuer of type
// KYC_PROVIDER, and the PersonKYC / AgentMandate CPTs it owns. Kept in db `bank`; redone when the WeID is gone (a
// regenerated chain).
import { PERSON_KYC_CPT, AGENT_MANDATE_CPT, type WeidClient } from '@praetor/weid-client';
import type { BankIdentity } from './kyc.js';

export type Kv = { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void> };

export async function ensureBankIdentity(weid: WeidClient, kv: Kv, name = 'Praetor Demo Bank'): Promise<BankIdentity> {
  const [w, kyc, mandate] = [await kv.get('bankWeId'), await kv.get('kycCpt'), await kv.get('mandateCpt')];
  if (w && kyc && mandate && (await weid.getWeIdDocument(w).then(() => true, () => false))) {
    return { bankWeId: w, kycCpt: Number(kyc), mandateCpt: Number(mandate) };
  }
  const bankWeId = await weid.createWeId();
  // Issuer names are unique on chain: suffix with the address so a redeployment never collides.
  await weid.ensureRecognizedIssuer(bankWeId, `${name} ${bankWeId.slice(-8)}`);
  const setup = await weid.issuerSetup(bankWeId);
  if (!setup.authorityIssuer || !setup.kycProvider) throw new Error('bank issuer setup not confirmed on chain');
  const kycCpt = await weid.registerCpt(bankWeId, PERSON_KYC_CPT as unknown as Record<string, unknown>);
  const mandateCpt = await weid.registerCpt(bankWeId, AGENT_MANDATE_CPT as unknown as Record<string, unknown>);
  await kv.set('bankWeId', bankWeId);
  await kv.set('kycCpt', String(kycCpt));
  await kv.set('mandateCpt', String(mandateCpt));
  return { bankWeId, kycCpt, mandateCpt };
}

/** One setup at a time; a failure is retried on the next call. */
export function memoIdentity(f: () => Promise<BankIdentity>): () => Promise<BankIdentity> {
  let p: Promise<BankIdentity> | undefined;
  return () => {
    p ??= f().catch((e) => {
      p = undefined;
      throw e;
    });
    return p;
  };
}
