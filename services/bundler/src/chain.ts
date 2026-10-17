// Base adapter of the bundler (viem): nonces, simulation, serialized submission from the bundler EOA.
import { decodeErrorResult, decodeEventLog, decodeFunctionData, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';
import { MandateHookAbi, RefusalLogAbi, baseNow, waitSynced, type Deployment } from '@praetor/chain';
import {
  ENTRY_POINT, FACTORY, LAUNCHPAD, initializer, launchpadAbi, packUserOp, predictAccountAddress, proxyCreationCode, decodeExecute,
  type Call, type UserOp, type LaunchpadInitData,
} from '@praetor/userop';
import type { Chain, SubmitResult } from './bundler.js';

const factoryAbi = parseAbi(['function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address)']);
const installSel = '0x9517e29f';

export class ViemChain implements Chain {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private pub: PublicClient, private wallet: WalletClient, private d: Deployment, private syncAttempts = 60) {}

  /** One bundler EOA transaction at a time: nonces stay in order and receipts are read in order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  getNonce(sender: Address, key: bigint) {
    return this.pub.readContract({ address: ENTRY_POINT, abi: entryPoint07Abi, functionName: 'getNonce', args: [sender, key] });
  }

  async isInitialized(account: Address) {
    const code = await this.pub.getCode({ address: account });
    if (!code || code === '0x') return false;
    return this.pub.readContract({ address: this.d.mandateHook, abi: MandateHookAbi, functionName: 'isInitialized', args: [account] });
  }

  async isOwnLaunchpadInit(sender: Address, factory: Address, factoryData: Hex, callData: Hex): Promise<boolean> {
    if (factory.toLowerCase() !== FACTORY.toLowerCase()) return false;
    try {
      const f = decodeFunctionData({ abi: factoryAbi, data: factoryData });
      const [singleton, init, salt] = f.args as readonly [Address, Hex, bigint];
      if (singleton.toLowerCase() !== LAUNCHPAD.toLowerCase()) return false;
      if (predictAccountAddress(init, salt, await proxyCreationCode(this.pub)).toLowerCase() !== sender.toLowerCase()) return false;
      const setup = decodeFunctionData({ abi: launchpadAbi, data: callData });
      if (setup.functionName !== 'setupSafe') return false;
      const data = setup.args[0] as LaunchpadInitData;
      if (initializer(data) !== init) return false;
      const lower = (a: string) => a.toLowerCase();
      const ownersOk = data.owners.length === 1 && lower(data.owners[0]!) === lower(this.d.noOwner) && data.threshold === 1n;
      const validatorsOk = data.validators.length === 2 && lower(data.validators[0]!.module) === lower(this.d.passkeyValidator)
        && lower(data.validators[1]!.module) === lower(this.d.agentKeyValidator);
      const installs = decodeExecute(data.callData).calls.filter((c) => c.data.startsWith(installSel)).map((c) => lower(c.data));
      const hookOk = installs.some((x) => x.includes(lower(this.d.mandateHook).slice(2)));
      return ownersOk && validatorsOk && hookOk;
    } catch {
      return false;
    }
  }

  estimateExecute(sender: Address, callData: Hex) {
    return this.pub.estimateGas({ account: ENTRY_POINT, to: sender, data: callData });
  }

  async fees() {
    const f = await this.pub.estimateFeesPerGas();
    return { maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
  }

  now() {
    return baseNow(this.pub);
  }

  async checkBatch(account: Address, calls: Call[]) {
    const [reasons] = await this.pub.readContract({
      address: this.d.mandateHook, abi: MandateHookAbi, functionName: 'checkBatch',
      args: [account, calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))],
    });
    return reasons.map(Number);
  }

  async simulateHandleOps(op: UserOp): Promise<string | null> {
    try {
      await this.pub.simulateContract({ address: ENTRY_POINT, abi: entryPoint07Abi, functionName: 'handleOps', args: [[packUserOp(op)], this.beneficiary()], account: this.wallet.account! });
      return null;
    } catch (e) {
      return aaError(e);
    }
  }

  submitHandleOps(op: UserOp, userOpHash: Hex): Promise<SubmitResult> {
    return this.serial(async () => {
      const gas = op.verificationGasLimit + op.callGasLimit + op.preVerificationGas + (op.paymasterVerificationGasLimit ?? 0n) + (op.paymasterPostOpGasLimit ?? 0n) + 300_000n;
      const txHash = await this.wallet.writeContract({
        address: ENTRY_POINT, abi: entryPoint07Abi, functionName: 'handleOps', args: [[packUserOp(op)], this.beneficiary()],
        account: this.wallet.account!, chain: this.wallet.chain, gas,
      });
      const r = await this.pub.waitForTransactionReceipt({ hash: txHash });
      await waitSynced(this.pub, r.blockNumber, { attempts: this.syncAttempts });
      for (const l of r.logs) {
        if (l.address.toLowerCase() !== ENTRY_POINT.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: entryPoint07Abi, data: l.data, topics: l.topics });
          if (ev.eventName === 'UserOperationEvent' && ev.args.userOpHash === userOpHash) {
            return { txHash, success: ev.args.success, userOpHash, gasUsed: ev.args.actualGasUsed };
          }
        } catch {
          // other EntryPoint events
        }
      }
      throw new Error(`no UserOperationEvent for ${userOpHash} in ${txHash}`);
    });
  }

  logRefusal(userOpHash: Hex, account: Address, calls: Call[]): Promise<Hex> {
    return this.serial(async () => {
      const single = calls.length === 1;
      const txHash = await this.wallet.writeContract(single
        ? { address: this.d.refusalLog, abi: RefusalLogAbi, functionName: 'log', args: [userOpHash, account, calls[0]!.to, calls[0]!.value, calls[0]!.data], account: this.wallet.account!, chain: this.wallet.chain }
        : { address: this.d.refusalLog, abi: RefusalLogAbi, functionName: 'logBatch', args: [userOpHash, account, calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))], account: this.wallet.account!, chain: this.wallet.chain });
      const r = await this.pub.waitForTransactionReceipt({ hash: txHash });
      await waitSynced(this.pub, r.blockNumber, { attempts: this.syncAttempts });
      return txHash;
    });
  }

  sendTx(to: Address, data: Hex) {
    return this.serial(async () => {
      const txHash = await this.wallet.sendTransaction({ to, data, account: this.wallet.account!, chain: this.wallet.chain });
      const r = await this.pub.waitForTransactionReceipt({ hash: txHash });
      await waitSynced(this.pub, r.blockNumber, { attempts: this.syncAttempts });
      return { txHash, success: r.status === 'success' };
    });
  }

  private beneficiary(): Address {
    return this.wallet.account!.address;
  }
}

const aaAbi = parseAbi(['error FailedOp(uint256 opIndex, string reason)', 'error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)']);

/** The EntryPoint's AA reason (AA24 signature error...) from a reverted simulation. */
function aaError(e: unknown): string {
  let cur: unknown = e;
  for (let i = 0; i < 10 && cur; i++) {
    const data = (cur as { data?: unknown }).data;
    if (typeof data === 'string' && data.startsWith('0x')) {
      try {
        const d = decodeErrorResult({ abi: aaAbi, data: data as Hex });
        return String((d.args as readonly unknown[])[1]);
      } catch {
        // not an EntryPoint error
      }
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return (e as Error).message?.split('\n')[0] ?? 'simulation failed';
}
