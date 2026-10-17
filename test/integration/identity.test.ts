// M6 gate: PersonKYC, AgentMandate with two signatures (user, then bank) and revocation, through packages/weid-client
// against the live weid-rest and weid-helper (identity network, reached from the host on their fixed addresses).
import { describe, it, expect, beforeAll } from 'vitest';
import { weidClient, type Credential } from '@praetor/weid-client';
import { PERSON_KYC_CPT, AGENT_MANDATE_CPT } from '@praetor/weid-client';

const weid = weidClient({
  restUrl: process.env.WEID_REST_URL ?? 'http://10.89.0.31:6001/weid/api/invoke',
  helperUrl: process.env.WEID_HELPER_URL ?? 'http://10.89.0.32:6100',
});
const inAYear = () => new Date(Date.now() + 365 * 86400_000);

let bank: string, user: string, stranger: string, kycCpt: number, mandateCpt: number;
const kycClaim = (holder: string) => ({ holder, ageOver18: true, jurisdiction: 'HK', riskProfile: 'balanced', sanctionsScreened: '2026-10-17', kycLevel: 2 });
const mandateClaim = (principal: string) => ({
  principal, wallet: 'eip155:84532:0x00000000000000000000000000000000000c0ffe', agentKey: '0x00000000000000000000000000000000000a6e47',
  scopes: ['rebalance', 'pay', 'standing_orders'], mandateHash: `0x${'ab'.repeat(32)}`, riskProfile: 'balanced', agentMeasurement: `0x${'cd'.repeat(32)}`,
});

beforeAll(async () => {
  [bank, user, stranger] = [await weid.createWeId(), await weid.createWeId(), await weid.createWeId()];
  await weid.ensureRecognizedIssuer(bank, `Praetor Test Bank ${Date.now()}`);
  expect(await weid.issuerSetup(bank)).toMatchObject({ authorityIssuer: true, kycProvider: true });
  kycCpt = await weid.registerCpt(bank, PERSON_KYC_CPT);
  mandateCpt = await weid.registerCpt(bank, AGENT_MANDATE_CPT);
}, 180_000);

describe('PersonKYC', () => {
  it('is valid once issued by the bank and evidenced, and invalid after revocation', async () => {
    const kyc = await weid.createCredential({ cptId: kycCpt, issuer: bank, expiresAt: inAYear(), claim: kycClaim(user) });
    await weid.createEvidence(kyc, bank);
    expect(await weid.verifyIssued(kyc, { issuer: bank, cptId: kycCpt })).toMatchObject({ valid: true, revoked: false });
    await weid.revoke(kyc, bank);
    expect(await weid.verifyIssued(kyc, { issuer: bank, cptId: kycCpt })).toMatchObject({ valid: false, revoked: true });
  }, 120_000);

  it('without evidence it is not valid (it could never be revoked)', async () => {
    const kyc = await weid.createCredential({ cptId: kycCpt, issuer: bank, expiresAt: inAYear(), claim: kycClaim(user) });
    expect(await weid.verifyIssued(kyc, { issuer: bank, cptId: kycCpt })).toMatchObject({ valid: false, evidence: false });
  }, 60_000);

  it('a tampered claim is not valid', async () => {
    const kyc = await weid.createCredential({ cptId: kycCpt, issuer: bank, expiresAt: inAYear(), claim: kycClaim(user) });
    await weid.createEvidence(kyc, bank);
    const tampered = { ...kyc, claim: { ...kyc.claim, kycLevel: 3 } } as Credential;
    expect((await weid.verifyIssued(tampered, { issuer: bank, cptId: kycCpt })).valid).toBe(false);
  }, 60_000);

  it('the same CPT issued by someone else is refused: the issuer is pinned, never read from the credential', async () => {
    const fake = await weid.createCredential({ cptId: kycCpt, issuer: stranger, expiresAt: inAYear(), claim: kycClaim(user) });
    await weid.createEvidence(fake, stranger);
    expect((await weid.verifyIssued(fake, { issuer: bank, cptId: kycCpt })).valid).toBe(false);
  }, 60_000);

  it('a bank credential of another CPT is refused', async () => {
    const other = await weid.createCredential({ cptId: mandateCpt, issuer: bank, expiresAt: inAYear(), claim: mandateClaim(user) });
    await weid.createEvidence(other, bank);
    expect((await weid.verifyIssued(other, { issuer: bank, cptId: kycCpt })).valid).toBe(false);
  }, 60_000);

  it('selective disclosure keeps the disclosed fields and verifies against the full credential evidence', async () => {
    const kyc = await weid.createCredential({ cptId: kycCpt, issuer: bank, expiresAt: inAYear(), claim: kycClaim(user) });
    const hash = await weid.createEvidence(kyc, bank);
    const sel = await weid.selective(kyc, ['jurisdiction', 'ageOver18']);
    expect(sel.claim.jurisdiction).toBe('HK');
    expect(sel.claim.kycLevel).not.toBe(2);
    expect(await weid.verifyIssued(sel, { issuer: bank, cptId: kycCpt, evidenceHash: hash })).toMatchObject({ valid: true });
    await weid.revoke(kyc, bank);
    expect(await weid.verifyIssued(sel, { issuer: bank, cptId: kycCpt, evidenceHash: hash })).toMatchObject({ valid: false, revoked: true });
  }, 120_000);
});

describe('AgentMandate (user signature, then the bank countersignature)', () => {
  it('carries both signatures: outer by the bank, inner by the user; revocable through its evidence', async () => {
    const inner = await weid.createCredential({ cptId: mandateCpt, issuer: user, expiresAt: inAYear(), claim: mandateClaim(user) });
    const { credential: outer } = await weid.countersign(inner, bank);
    expect(outer.issuer).toBe(bank);
    const list = outer.claim.credentialList as Credential[];
    expect(list).toHaveLength(1);
    expect(list[0]!.issuer).toBe(user);
    expect((await weid.verifyMandate(outer, { bank, principal: user, cptId: mandateCpt })).valid).toBe(false); // no evidence yet
    await weid.createEvidence(outer, bank);
    expect(await weid.verifyMandate(outer, { bank, principal: user, cptId: mandateCpt })).toMatchObject({ valid: true });
    await weid.revoke(outer, bank);
    expect(await weid.verifyMandate(outer, { bank, principal: user, cptId: mandateCpt })).toMatchObject({ valid: false, revoked: true });
  }, 120_000);

  it('a tampered inner claim fails', async () => {
    const inner = await weid.createCredential({ cptId: mandateCpt, issuer: user, expiresAt: inAYear(), claim: mandateClaim(user) });
    const { credential: outer } = await weid.countersign(inner, bank);
    await weid.createEvidence(outer, bank);
    const t = JSON.parse(JSON.stringify(outer).replace('"standing_orders"', '"withdraw"')) as Credential;
    expect((await weid.verifyMandate(t, { bank, principal: user, cptId: mandateCpt })).valid).toBe(false);
  }, 60_000);

  it('an inner credential signed by someone other than the principal fails', async () => {
    const inner = await weid.createCredential({ cptId: mandateCpt, issuer: stranger, expiresAt: inAYear(), claim: mandateClaim(user) });
    const { credential: outer } = await weid.countersign(inner, bank);
    await weid.createEvidence(outer, bank);
    expect((await weid.verifyMandate(outer, { bank, principal: user, cptId: mandateCpt })).valid).toBe(false);
  }, 60_000);
});
