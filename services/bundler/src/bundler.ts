// Our own ERC-4337 bundler (spec 05, D22): prepare (nonce, gas, sponsorship) then send (simulate, submit, log
// refusals on-chain). Untrusted for safety: it can withhold, never forge; every authority check is on-chain.
import type { Address, Hex } from 'viem';
import { decodeExecute, nonceKey, userOpHash, withPaymasterSignature, type Call, type UserOp } from '@praetor/userop';
import type { Store } from './store.js';

export class NotSponsorable extends Error {}
export class RateLimited extends Error {}
export class ValidationFailed extends Error {}
export class NotAllowed extends Error {}

export type SubmitResult = { txHash: Hex; success: boolean; userOpHash: Hex; gasUsed: bigint };

/** What the bundler needs from Base; ViemChain in production, fakes in unit tests. */
export interface Chain {
  getNonce(sender: Address, key: bigint): Promise<bigint>;
  isInitialized(account: Address): Promise<boolean>;
  /** The first op deploys our account: our factory and launchpad, NoOwner, our validators, our hook and executor. */
  isOwnLaunchpadInit(sender: Address, factory: Address, factoryData: Hex, callData: Hex): Promise<boolean>;
  estimateExecute(sender: Address, callData: Hex): Promise<bigint>;
  fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  now(): Promise<bigint>;
  checkBatch(account: Address, calls: Call[]): Promise<number[]>;
  /** null when EntryPoint validation passes, else the AA error. */
  simulateHandleOps(op: UserOp): Promise<string | null>;
  submitHandleOps(op: UserOp, userOpHash: Hex): Promise<SubmitResult>;
  logRefusal(userOpHash: Hex, account: Address, calls: Call[]): Promise<Hex>;
  sendTx(to: Address, data: Hex): Promise<{ txHash: Hex; success: boolean }>;
}

export type BundlerConfig = {
  paymaster: Address;
  paymasterKey: Hex;
  chainId: number;
  maxRefusedPerDay: number;
  skipRefused: boolean;
  validators: { agent: Address; passkey: Address };
  txTargets: Address[];
};

export type PrepareRequest = { sender: Address; callData: Hex; validator: 'agent' | 'passkey'; factory?: Address; factoryData?: Hex };
export type SendResult = { userOpHash: Hex; txHash: Hex | null; success: boolean | null; reasons: number[]; refusalLogTx: Hex | null; skipped: boolean; gasUsed?: bigint };

const MIN_CALL_GAS = 300_000n;
const FIRST_OP_VERIFICATION_GAS = 3_000_000n;
const FIRST_OP_CALL_GAS = 2_000_000n;
const SPONSORSHIP_TTL_S = 600n;

export class Bundler {
  constructor(private chain: Chain, private store: Store, private cfg: BundlerConfig) {}

  accounts(): Promise<Address[]> {
    return this.store.accounts();
  }

  async register(address: Address): Promise<void> {
    await this.store.register(address);
  }

  async prepare(r: PrepareRequest): Promise<{ userOp: UserOp; userOpHash: Hex }> {
    await this.assertSponsorable(r.sender, r.callData, r.factory, r.factoryData);
    const first = r.factory !== undefined;
    const validator = this.cfg.validators[r.validator];
    const fees = await this.chain.fees();
    const op: UserOp = {
      sender: r.sender,
      nonce: await this.chain.getNonce(r.sender, nonceKey(validator)),
      ...(first ? { factory: r.factory, factoryData: r.factoryData } : {}),
      callData: r.callData,
      callGasLimit: first ? FIRST_OP_CALL_GAS : await this.callGas(r.sender, r.callData),
      verificationGasLimit: first ? FIRST_OP_VERIFICATION_GAS : r.validator === 'passkey' ? 800_000n : 300_000n,
      preVerificationGas: 100_000n,
      ...fees,
      signature: '0x',
    };
    const until = Number((await this.chain.now()) + SPONSORSHIP_TTL_S);
    const sponsored = await withPaymasterSignature(op, { paymaster: this.cfg.paymaster, key: this.cfg.paymasterKey, validUntil: until, validAfter: 0, chainId: this.cfg.chainId });
    return { userOp: sponsored, userOpHash: userOpHash(sponsored, this.cfg.chainId) };
  }

  async send(op: UserOp): Promise<SendResult> {
    await this.assertSponsorable(op.sender, op.callData, op.factory, op.factoryData);
    if (op.paymaster?.toLowerCase() !== this.cfg.paymaster.toLowerCase()) throw new NotSponsorable('not sponsored by our paymaster');
    const hash = userOpHash(op, this.cfg.chainId);
    const calls = op.factory ? [] : this.calls(op.callData);
    const reasons = calls.length ? await this.chain.checkBatch(op.sender, calls) : [];
    const refused = reasons.some((r) => r !== 0);
    const day = Number((await this.chain.now()) / 86_400n);
    const validator = op.nonce >> 64n === nonceKey(this.cfg.validators.passkey) ? 'passkey' : 'agent';
    if (refused) {
      if ((await this.store.refusalCount(op.sender, day)) >= this.cfg.maxRefusedPerDay) throw new RateLimited('too many refused ops today');
      if (this.cfg.skipRefused) {
        await this.store.recordOp({ userOpHash: hash, sender: op.sender, validator, txHash: null, success: null, reasons, refusalLogTx: null });
        return { userOpHash: hash, txHash: null, success: null, reasons, refusalLogTx: null, skipped: true };
      }
    }
    const invalid = await this.chain.simulateHandleOps(op);
    if (invalid) throw new ValidationFailed(invalid);
    const res = await this.chain.submitHandleOps(op, hash);
    let refusalLogTx: Hex | null = null;
    if (!res.success && refused) {
      refusalLogTx = await this.chain.logRefusal(hash, op.sender, calls);
      await this.store.bumpRefusal(op.sender, day);
    }
    await this.store.recordOp({ userOpHash: hash, sender: op.sender, validator, txHash: res.txHash, success: res.success, reasons, refusalLogTx });
    return { userOpHash: hash, txHash: res.txHash, success: res.success, reasons, refusalLogTx, skipped: false, gasUsed: res.gasUsed };
  }

  /** Plain transactions from the bundler EOA, to our own contracts only (registerApproval, apply*, anchors...). */
  async tx(to: Address, data: Hex): Promise<{ txHash: Hex; success: boolean }> {
    if (!this.cfg.txTargets.some((t) => t.toLowerCase() === to.toLowerCase())) throw new NotAllowed(`target ${to} not allowed`);
    return this.chain.sendTx(to, data);
  }

  getOp(h: Hex) {
    return this.store.getOp(h);
  }

  /** isInitialized alone is not enough (anyone can install the hook on their own contract): also registered. */
  private async assertSponsorable(sender: Address, callData: Hex, factory?: Address, factoryData?: Hex): Promise<void> {
    if (!(await this.store.isRegistered(sender))) throw new NotSponsorable('account not registered');
    if (factory && factoryData) {
      if (!(await this.chain.isOwnLaunchpadInit(sender, factory, factoryData, callData))) throw new NotSponsorable('not our launchpad init');
      return;
    }
    if (!(await this.chain.isInitialized(sender))) throw new NotSponsorable('account not initialized');
  }

  private async callGas(sender: Address, callData: Hex): Promise<bigint> {
    try {
      const est = (await this.chain.estimateExecute(sender, callData)) * 13n / 10n;
      return est > MIN_CALL_GAS ? est : MIN_CALL_GAS;
    } catch {
      return MIN_CALL_GAS;
    }
  }

  private calls(callData: Hex): Call[] {
    try {
      return decodeExecute(callData).calls;
    } catch {
      return [];
    }
  }
}
