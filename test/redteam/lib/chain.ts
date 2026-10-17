// Base reads and attacker transactions for the red-team suite (anvil fork only): protected state and transfers around
// an attack, refusal records, the hook's revert inside a failed userOp, and plain transactions from a fresh attacker.
import {
  concat, createWalletClient, decodeErrorResult, encodeFunctionData, http, isHex, keccak256, pad, parseAbi, parseAbiItem, toHex,
  type Address, type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentKeyValidatorAbi, MandateHookAbi, PasskeyValidatorAbi, PayoutRailAbi, StandingOrdersAbi, baseNow } from '@praetor/chain';
import { REASONS, TIERS, type ReasonName } from '@praetor/protocol';
import { ENTRY_POINT } from '@praetor/userop';
import { pub, type Stack } from '../../../scripts/demo/lib.js';
import type { ChainState, HookEvent, Transfer } from './effects.js';
import type { TierName } from './classify.js';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const REFUSED = parseAbiItem('event Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter)');
const HOOK_EVENTS = [
  parseAbiItem('event ApprovalRegistered(address indexed account, bytes32 indexed callHash, uint8 authKind, uint64 expiresAt)'),
  parseAbiItem('event OwnerActionApplied(address indexed account, uint8 indexed action, bytes32 payloadHash, uint8 authKind, bytes32 digest)'),
  parseAbiItem('event PolicySet(address indexed account, bytes32 policyHash)'),
] as const;
// Errors of the contracts an attacker transaction may hit, beyond the hook (whose ABI carries its libraries' errors).
const SAFE7579_ERRORS = parseAbi(['error InvalidModule(address module)', 'error ExecutionFailed()', 'error UnsupportedCallType(bytes1 callType)', 'error InvalidCallType()']);
const DECODE_ABI = [...MandateHookAbi, ...StandingOrdersAbi, ...PayoutRailAbi, ...SAFE7579_ERRORS] as const;

export type Refusal = { userOpHash: Hex; reason: ReasonName; tier: TierName; tx: Hex };

/** The revert data carried somewhere in a viem error chain. */
export function revertData(e: unknown): Hex | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 12 && cur; i++) {
    const data = (cur as { data?: unknown }).data;
    if (typeof data === 'string' && isHex(data) && data.length >= 10) return data;
    if (data && typeof data === 'object' && typeof (data as { data?: unknown }).data === 'string') return (data as { data: Hex }).data;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A revert as a name: custom error (BadNonce), Error(string) text (GS024), or the selector. */
export function revertName(e: unknown): string {
  const data = revertData(e);
  if (data) {
    try {
      const d = decodeErrorResult({ abi: DECODE_ABI, data }) as { errorName: string; args?: readonly unknown[] };
      if (d.errorName === 'MandateRefused') return `MandateRefused(${REASONS[Number((d.args as readonly unknown[])[0])]})`;
      if (d.errorName === 'Error') return String((d.args as readonly unknown[])[0]);
      return d.errorName;
    } catch {
      return data.slice(0, 10);
    }
  }
  const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
  const m = /reverted with (?:the following )?reason:?\s*([^\n]+?)\.?$/m.exec(msg);
  return (m ? m[1]! : msg.split('\n')[0]!).trim();
}

export class Chain {
  readonly p;
  constructor(readonly s: Stack) {
    this.p = pub(s);
  }

  now = () => baseNow(this.p);
  block = () => this.p.getBlockNumber();

  hook<T>(functionName: string, args: readonly unknown[]): Promise<T> {
    return this.p.readContract({ address: this.s.base.mandateHook, abi: MandateHookAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  }

  async state(account: Address): Promise<ChainState> {
    const b = this.s.base;
    const [policyHash, agent, binding, status, statusNonce, installed, keys] = await Promise.all([
      this.hook<Hex>('policyHashOf', [account]),
      this.p.readContract({ address: b.agentKeyValidator, abi: AgentKeyValidatorAbi, functionName: 'agentOf', args: [account] }) as Promise<readonly [Address, number, boolean]>,
      this.hook<Hex>('bindingOf', [account]),
      this.hook<readonly [number, number, number, bigint]>('statusOf', [account]),
      this.hook<bigint>('nonces', [0, pad(account)]),
      this.hook<boolean>('isInitialized', [account]),
      this.p.readContract({ address: b.passkeyValidator, abi: PasskeyValidatorAbi, functionName: 'keyCount', args: [account] }) as Promise<bigint>,
    ]);
    return {
      policyHash, agentKey: agent[0], agentValidUntil: BigInt(agent[1]), agentRevoked: agent[2], binding, status: Number(status[0]),
      statusNonce: BigInt(statusNonce), hookInstalled: installed, ownerKeys: Number(keys),
    };
  }

  async transfers(account: Address, fromBlock: bigint, toBlock: bigint): Promise<Transfer[]> {
    const b = this.s.base;
    const logs = await this.p.getLogs({ address: [b.usdc, b.txau, b.txag], event: TRANSFER, args: { from: account }, fromBlock, toBlock });
    return logs.map((l) => ({ token: l.address, from: l.args.from!, to: l.args.to!, value: l.args.value!, tx: l.transactionHash! }));
  }

  async hookEvents(account: Address, fromBlock: bigint, toBlock: bigint): Promise<HookEvent[]> {
    const out: HookEvent[] = [];
    for (const event of HOOK_EVENTS) {
      const logs = await this.p.getLogs({ address: this.s.base.mandateHook, event: event as typeof HOOK_EVENTS[0], args: { account }, fromBlock, toBlock });
      out.push(...logs.map((l) => ({ name: event.name as HookEvent['name'], tx: l.transactionHash! })));
    }
    return out;
  }

  async refusals(account: Address, fromBlock: bigint, toBlock: bigint): Promise<Refusal[]> {
    const logs = await this.p.getLogs({ address: this.s.base.refusalLog, event: REFUSED, args: { account }, fromBlock, toBlock });
    return logs.map((l) => ({ userOpHash: l.args.userOpHash!, reason: REASONS[Number(l.args.reason)]!, tier: TIERS[Number(l.args.tier)] as TierName, tx: l.transactionHash! }));
  }

  /** The hook's MandateRefused inside a mined transaction, from the call trace (anvil debug_traceTransaction). */
  async refusalInTx(txHash: Hex): Promise<ReasonName | undefined> {
    type Frame = { to?: string; output?: string; error?: string; calls?: Frame[] };
    const trace = (await this.p.request({ method: 'debug_traceTransaction' as never, params: [txHash, { tracer: 'callTracer' }] as never }).catch(() => null)) as Frame | null;
    // MandateRefused is the hook's own error: match it in any frame (Safe7579 re-throws it as ExecutionFailed()).
    const walk = (f: Frame | undefined): ReasonName | undefined => {
      if (!f) return undefined;
      for (const c of f.calls ?? []) {
        const r = walk(c);
        if (r) return r;
      }
      if (f.output && isHex(f.output) && f.output.length >= 10) {
        try {
          const d = decodeErrorResult({ abi: MandateHookAbi, data: f.output as Hex });
          if (d.errorName === 'MandateRefused') return REASONS[Number((d.args as readonly unknown[])[0])];
        } catch {
          // not a hook refusal
        }
      }
      return undefined;
    };
    return walk(trace ?? undefined);
  }

  /** The input of the call to `to` with this selector inside a mined transaction (callTracer), else its own input. */
  async innerCall(txHash: Hex, to: Address, selector: Hex): Promise<Hex | undefined> {
    type Frame = { to?: string; input?: string; calls?: Frame[] };
    const trace = (await this.p.request({ method: 'debug_traceTransaction' as never, params: [txHash, { tracer: 'callTracer' }] as never }).catch(() => null)) as Frame | null;
    const find = (f: Frame | undefined): Hex | undefined => {
      if (!f) return undefined;
      if (f.to?.toLowerCase() === to.toLowerCase() && f.input?.startsWith(selector)) return f.input as Hex;
      for (const c of f.calls ?? []) {
        const r = find(c);
        if (r) return r;
      }
      return undefined;
    };
    const hit = find(trace ?? undefined);
    if (hit) return hit;
    const tx = await this.p.getTransaction({ hash: txHash });
    return tx.to?.toLowerCase() === to.toLowerCase() && tx.input.startsWith(selector) ? tx.input : undefined;
  }

  /** What the hook's preCheck says about this execute callData for the account (simulated at the current state). */
  async preCheckReason(account: Address, callData: Hex, msgSender: Address = ENTRY_POINT): Promise<ReasonName | undefined> {
    try {
      await this.p.call({ account, to: this.s.base.mandateHook, data: encodeFunctionData({ abi: MandateHookAbi, functionName: 'preCheck', args: [msgSender, 0n, concat([callData, msgSender])] }) });
      return undefined;
    } catch (e) {
      const m = /^MandateRefused\((\w+)\)$/.exec(revertName(e));
      return m ? (m[1] as ReasonName) : undefined;
    }
  }

  /** A fresh attacker address with gas money (fork only): its own key, never a stack key. */
  async attacker(label: string) {
    const account = privateKeyToAccount(keccak256(toHex(`praetor-redteam-attacker:${label}`)));
    await this.p.request({ method: 'anvil_setBalance' as never, params: [account.address, toHex(10n ** 17n)] as never });
    return account;
  }

  /** Simulates (for the revert name) then sends with a fixed gas limit, so a refusal is mined and has a hash. */
  async attackTx(label: string, to: Address, data: Hex, value = 0n): Promise<{ txHash: Hex; success: boolean; error?: string; from: Address }> {
    const a = await this.attacker(label);
    let error: string | undefined;
    try {
      await this.p.call({ account: a.address, to, data, value });
    } catch (e) {
      error = revertName(e);
    }
    const w = createWalletClient({ chain: baseSepolia, transport: http(this.s.baseRpc), account: a });
    const txHash = await w.sendTransaction({ to, data, value, gas: 3_000_000n, chain: baseSepolia });
    const r = await this.p.waitForTransactionReceipt({ hash: txHash });
    return { txHash, success: r.status === 'success', error, from: a.address };
  }

  /** Every log of an event of the hook for an account since the deployment (anvil serves wide ranges). */
  async hookLogs(eventSig: string, args: Record<string, unknown>): Promise<{ args: Record<string, unknown>; transactionHash: Hex }[]> {
    const event = parseAbiItem(eventSig) as never;
    const logs = await this.p.getLogs({ address: this.s.base.mandateHook, event, args: args as never, fromBlock: BigInt(this.s.base.deployBlock), toBlock: 'latest' });
    return logs as unknown as { args: Record<string, unknown>; transactionHash: Hex }[];
  }
}

