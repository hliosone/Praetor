// F1 onboarding (spec 06) as the api runs it, steps 3 to 12: the first userOp (launchpad init, signed by the new
// passkey), KYC at the bank, the agent key from the TEE with its quote verified by the bank, the agent DID, then the
// AgentMandate signed with the passkey and the KYA the bank builds. The api decides nothing.
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { encodePasskeySignature } from '@praetor/protocol';
import { toMemberAssertion, toWebAuthnAuth, type AssertionJSON } from './assertion.js';
import type { Clients } from './clients.js';

export type OnboardingDeps = {
  user(account: Address): Promise<{ userId: string; account: Address; credIdHash: Hex }>;
  isDeployed(account: Address): Promise<boolean>;
  firstOp(account: Address): Promise<{ factory: Address; factoryData: Hex; callData: Hex }>;
  now(): Promise<bigint>;
  c: Pick<Clients, 'bundler' | 'bank' | 'signer'>;
};

const SCOPES = ['rebalance', 'pay', 'standing_orders'];
const KYA_VALIDITY_S = 365n * 86_400n;

export class Onboarding {
  private pending = new Map<string, { userOp: Record<string, unknown>; userOpHash: Hex }>();
  private agents = new Map<string, Address>();

  constructor(private readonly d: OnboardingDeps) {}

  async deployPrepare(account: Address) {
    if (await this.d.isDeployed(account)) return { deployed: true as const };
    const f = await this.d.firstOp(account);
    await this.d.c.bundler.register(account);
    const p = await this.d.c.bundler.prepare({ sender: account, callData: f.callData, validator: 'passkey', factory: f.factory, factoryData: f.factoryData });
    this.pending.set(account.toLowerCase(), p);
    return { deployed: false as const, userOpHash: p.userOpHash };
  }

  async deploySubmit(account: Address, assertion: AssertionJSON) {
    const p = this.pending.get(account.toLowerCase());
    if (!p) throw new Error('no prepared deployment');
    const { credIdHash } = await this.d.user(account);
    const signature = encodePasskeySignature(credIdHash, toWebAuthnAuth(assertion, p.userOpHash));
    const r = await this.d.c.bundler.send({ ...p.userOp, signature });
    if (r.success) this.pending.delete(account.toLowerCase());
    return r;
  }

  async kycStart(account: Address, method: 'vendor' | 'eudi') {
    const { userId } = await this.d.user(account);
    return this.d.c.bank.kycStart(userId, account, method);
  }

  async kycStatus(account: Address) {
    return this.d.c.bank.kycStatus((await this.d.user(account)).userId);
  }

  async suitability(account: Address, answers: number[]) {
    return this.d.c.bank.suitability((await this.d.user(account)).userId, answers);
  }

  async agentCreate(account: Address) {
    const { nonce } = await this.d.c.bank.kyaNonce(account);
    const { address: agentKey, quote } = await this.d.c.signer.attest(account, nonce);
    const v = await this.d.c.bank.kyaVerify({ account, agentKey, quote, nonce });
    const did = await this.d.c.bank.agentDid(account);
    this.agents.set(account.toLowerCase(), agentKey);
    const info = await this.d.c.signer.info();
    return { agentKey, measurement: v.measurement, agentWeId: did.agentWeId, agentDidHash: did.agentDidHash, simulator: info.simulator };
  }

  async mandateDraft(account: Address) {
    const { userId } = await this.d.user(account);
    const agentKey = this.agents.get(account.toLowerCase()) ?? (await this.d.c.signer.address(account)).address;
    const mandateHash = keccak256(toHex(JSON.stringify({ account: account.toLowerCase(), agentKey: agentKey.toLowerCase(), scopes: SCOPES })));
    return this.d.c.bank.mandatePrepare({ userRef: userId, account, agentKey, scopes: SCOPES, mandateHash });
  }

  async mandateSign(account: Address, b: { draftId: string; challenge: Hex; agentDidHash: Hex; assertion: AssertionJSON }) {
    const { credIdHash } = await this.d.user(account);
    const signed = await this.d.c.bank.mandateSign(b.draftId, toMemberAssertion(b.assertion, b.challenge, credIdHash));
    const kya = await this.d.c.bank.kya({ account, agentDidHash: b.agentDidHash, validUntil: (await this.d.now()) + KYA_VALIDITY_S });
    return { mandateCredentialHash: signed.mandateCredentialHash, kya };
  }
}
