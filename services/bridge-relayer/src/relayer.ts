// Bridge-relayer (spec 05): delivers Ready consortium attestations from FISCO's BaseOutbox to Base. Untrusted: it
// can delay, never forge (the hook verifies every member signature). BRIDGE=relayer delivers at once;
// BRIDGE=wecross only delivers what WeCross has not delivered within BRIDGE_WATCHDOG_S.
import { decodeAbiParameters, encodeFunctionData, type Address, type Hex } from 'viem';
import { MandateHookAbi, AnchorAbi } from '@praetor/chain';
import { types } from '@praetor/protocol';

export type OutboxMessage = { id: bigint; kind: number; payload: Hex; sigs: Hex[]; enqueuedAt: bigint };

export interface OutboxPort {
  pending(from: bigint, max: number): Promise<OutboxMessage[]>;
  markDelivered(id: bigint, baseTx: Hex, transport: number): Promise<Hex>;
  /** FISCO time in seconds: the clock enqueuedAt is written in (the watchdog compares like with like). */
  now(): Promise<bigint>;
}

export interface BasePort {
  /** eth_call of the delivery: ok, or the decoded error name. */
  simulate(to: Address, data: Hex): Promise<{ ok: true } | { ok: false; error: string }>;
  send(to: Address, data: Hex): Promise<{ txHash: Hex; success: boolean }>;
  /** The nonce (or epoch, or anchor seq) Base has applied for this message's key. */
  appliedNonce(kind: number, message: Record<string, unknown>): Promise<bigint>;
}

/** BRIDGE=wecross: BaseOutbox.requestWeCross, sent with the WeCross router's own FISCO key (D42). */
export interface WeCrossPort {
  requested(id: bigint): Promise<boolean>;
  request(id: bigint): Promise<void>;
}

export type Outcome = 'delivered' | 'already-applied' | 'blocked' | 'expired' | 'waiting' | 'requested' | 'failed';
export type TickResult = { id: bigint; outcome: Outcome; txHash?: Hex; error?: string };

const KINDS = [
  ['StatusAttestation', 'applyStatus'], ['HeartbeatAttestation', 'applyHeartbeat'], ['CapsAttestation', 'applyCaps'],
  ['KYAAttestation', 'applyKYA'], ['AssetAttestation', 'applyAsset'], ['SanctionsAttestation', 'applySanctions'],
  ['JurisdictionAttestation', 'applyJurisdiction'], ['AttesterAttestation', 'applyAttester'], ['AnchorAttestation', 'anchor'],
] as const;
export const ANCHOR_KIND = 8;
const ZERO = `0x${'00'.repeat(32)}` as Hex;

export function decodeMessage(m: OutboxMessage): { primaryType: (typeof KINDS)[number][0]; fn: string; message: Record<string, unknown> } {
  const k = KINDS[m.kind];
  if (!k) throw new Error(`unknown message kind ${m.kind}`);
  const [message] = decodeAbiParameters([{ type: 'tuple', components: types[k[0]] as never }], m.payload) as unknown as [Record<string, unknown>];
  return { primaryType: k[0], fn: k[1], message };
}

export class Relayer {
  constructor(private outbox: OutboxPort, private base: BasePort, private cfg: { hook: Address; anchor: Address; mode: 'relayer' | 'wecross'; watchdogS: bigint; batch?: number }, private wecross?: WeCrossPort) {}

  async tick(): Promise<TickResult[]> {
    const out: TickResult[] = [];
    const now = await this.outbox.now();
    for (const m of await this.outbox.pending(0n, this.cfg.batch ?? 50)) out.push(await this.deliver(m, now));
    return out;
  }

  private async deliver(m: OutboxMessage, now: bigint): Promise<TickResult> {
    if (this.cfg.mode === 'wecross' && now - m.enqueuedAt < this.cfg.watchdogS) {
      if (this.wecross && !(await this.wecross.requested(m.id))) {
        await this.wecross.request(m.id);
        return { id: m.id, outcome: 'requested' };
      }
      return { id: m.id, outcome: 'waiting' };
    }
    const { fn, message } = decodeMessage(m);
    const to = m.kind === ANCHOR_KIND ? this.cfg.anchor : this.cfg.hook;
    const data = m.kind === ANCHOR_KIND
      ? encodeFunctionData({ abi: AnchorAbi, functionName: 'anchor', args: [message as never, m.sigs] })
      : encodeFunctionData({ abi: MandateHookAbi, functionName: fn as never, args: [message, m.sigs] as never });
    const sim = await this.base.simulate(to, data);
    if (!sim.ok) {
      if (/BadNonce|BadSequence/.test(sim.error)) {
        const applied = await this.base.appliedNonce(m.kind, message);
        const own = BigInt((message.nonce ?? message.epoch ?? message.seq) as bigint);
        if (applied >= own) {
          await this.outbox.markDelivered(m.id, ZERO, this.cfg.mode === 'wecross' ? 1 : 0);
          return { id: m.id, outcome: 'already-applied' };
        }
        return { id: m.id, outcome: 'blocked', error: sim.error };
      }
      if (/Expired/.test(sim.error)) return { id: m.id, outcome: 'expired', error: sim.error };
      return { id: m.id, outcome: 'failed', error: sim.error };
    }
    const r = await this.base.send(to, data);
    if (!r.success) return { id: m.id, outcome: 'failed', txHash: r.txHash };
    await this.outbox.markDelivered(m.id, r.txHash, 0);
    return { id: m.id, outcome: 'delivered', txHash: r.txHash };
  }
}
