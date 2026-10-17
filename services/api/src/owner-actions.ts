// Owner actions (spec 02) through the api, which only prepares and relays: the owner's device signs the EIP-712 digest
// it recomputed itself, the bank co-signs where spec 02 says so (and checks the payload), the hook verifies all of it.
import { randomBytes } from 'node:crypto';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { digest, ownerActionPayload, ownerActionPayloadHash, passkeyAuth, praetorDomain, OwnerActionKind as K, type OwnerAction } from '@praetor/protocol';
import { toWebAuthnAuth, type AssertionJSON } from './assertion.js';

export const BANK_REQUIRED: ReadonlySet<number> = new Set([K.SET_POLICY, K.ADD_STANDING_ORDER, K.LINK_WECHAT, K.SET_AGENT_KEY, K.SET_OWNER_KEY, K.MODULE_CHANGE]);
const EXPIRY_S = 600n;

export type OwnerActionDeps = {
  domain: { name: string; hook: Address };
  now(): Promise<bigint>;
  /** The credIdHash of the owner's passkey that made this assertion (by credential id; an account can hold several). */
  credIdHashOf(account: Address, credentialId: string): Promise<Hex>;
  bank: { cosign(ownerAction: OwnerAction, payload: Hex): Promise<{ bankSig: Hex }> };
  bundler: { tx(to: Address, data: Hex): Promise<{ txHash: Hex | null; success: boolean }> };
};

export class OwnerActions {
  constructor(private readonly d: OwnerActionDeps) {}

  async prepare(account: Address, args: Parameters<typeof ownerActionPayload>[0], fiscoRef: Hex = `0x${'00'.repeat(32)}`) {
    if (args.account.toLowerCase() !== account.toLowerCase()) throw new Error('owner action for another account');
    const { payload, payloadHash } = ownerActionPayload(args);
    const ownerAction: OwnerAction = {
      account, action: args.kind, payloadHash, nonce: BigInt(`0x${randomBytes(8).toString('hex')}`), expiresAt: (await this.d.now()) + EXPIRY_S, fiscoRef,
    };
    return { ownerAction, payload, digest: digest(praetorDomain(this.d.domain.name, this.d.domain.hook), 'OwnerAction', ownerAction) };
  }

  async submit(account: Address, b: { ownerAction: OwnerAction; payload: Hex; assertion: AssertionJSON }) {
    const a = b.ownerAction;
    if (a.account.toLowerCase() !== account.toLowerCase()) throw new Error('owner action for another account');
    if (ownerActionPayloadHash(a.account, a.action, b.payload).toLowerCase() !== a.payloadHash.toLowerCase()) throw new Error('payload does not match its hash');
    const d = digest(praetorDomain(this.d.domain.name, this.d.domain.hook), 'OwnerAction', a);
    const auth = passkeyAuth(await this.d.credIdHashOf(account, b.assertion.id), toWebAuthnAuth(b.assertion, d));
    const bankSigs = BANK_REQUIRED.has(a.action) ? [(await this.d.bank.cosign(a, b.payload)).bankSig] : [];
    const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'applyOwnerAction', args: [a, b.payload, auth, bankSigs] as never });
    return this.d.bundler.tx(this.d.domain.hook, data);
  }
}
