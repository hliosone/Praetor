import { decodeErrorResult, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { AnchorAbi, MandateHookAbi, type Deployment } from '@praetor/chain';
import { BaseOutboxAbi, sendFisco } from '@praetor/fisco-client';
import type { BasePort, OutboxMessage, OutboxPort, WeCrossPort } from './relayer.js';

export class FiscoOutbox implements OutboxPort {
  constructor(private pub: PublicClient, private wallet: WalletClient, private outbox: Address) {}

  async pending(from: bigint, max: number): Promise<OutboxMessage[]> {
    const [ids, msgs] = (await this.pub.readContract({ address: this.outbox, abi: BaseOutboxAbi, functionName: 'pending', args: [from, BigInt(max)] })) as readonly [readonly bigint[], readonly { kind: number; payload: Hex; sigs: readonly Hex[]; enqueuedAt: bigint }[]];
    return ids.map((id, i) => ({ id, kind: msgs[i]!.kind, payload: msgs[i]!.payload, sigs: [...msgs[i]!.sigs], enqueuedAt: msgs[i]!.enqueuedAt }));
  }

  async markDelivered(id: bigint, baseTx: Hex, transport: number): Promise<Hex> {
    const r = await sendFisco(this.pub, this.wallet, { address: this.outbox, abi: BaseOutboxAbi as never, functionName: 'markDelivered', args: [id, baseTx, transport] });
    return r.transactionHash;
  }

  /** FISCO block time is in milliseconds; enqueuedAt is written in seconds. */
  async now(): Promise<bigint> {
    return (await this.pub.getBlock()).timestamp / 1000n;
  }
}

/** BaseOutbox.requestWeCross, signed by the WeCross router's FISCO account: the hub records it as the requester. */
export class FiscoWeCross implements WeCrossPort {
  constructor(private pub: PublicClient, private wallet: WalletClient, private outbox: Address) {}

  async requested(id: bigint): Promise<boolean> {
    return (await this.pub.readContract({ address: this.outbox, abi: BaseOutboxAbi, functionName: 'requested', args: [id] })) as boolean;
  }

  async request(id: bigint): Promise<void> {
    await sendFisco(this.pub, this.wallet, { address: this.outbox, abi: BaseOutboxAbi as never, functionName: 'requestWeCross', args: [id] });
  }
}

// FISCO board kind -> MandateHook.nonces(kind) numbering (spec 03 views).
const HOOK_NONCE_KIND: Record<number, number> = { 0: 0, 1: 7, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
const pad = (v: string | number | bigint): Hex => `0x${BigInt(v).toString(16).padStart(64, '0')}`;

export class BaseAdapter implements BasePort {
  constructor(private pub: PublicClient, private d: Deployment, private bundler: { url: string; token: string }) {}

  async simulate(to: Address, data: Hex): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      // The hook's apply* do not depend on the caller: simulate without an account.
      await this.pub.call({ to, data });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorName(e) };
    }
  }

  async send(to: Address, data: Hex): Promise<{ txHash: Hex; success: boolean }> {
    const r = await fetch(`${this.bundler.url}/tx`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.bundler.token}` }, body: JSON.stringify({ to, data }),
    });
    if (!r.ok) throw new Error(`bundler /tx ${r.status}: ${await r.text()}`);
    return (await r.json()) as { txHash: Hex; success: boolean };
  }

  async appliedNonce(kind: number, m: Record<string, unknown>): Promise<bigint> {
    if (kind === 8) return (await this.pub.readContract({ address: this.d.anchor, abi: AnchorAbi, functionName: 'seq' })) as bigint;
    const key = kind === 0 || kind === 3 ? pad(m.account as string) : kind === 2 ? pad(m.riskProfile as number) : kind === 4 ? pad(m.asset as string)
      : kind === 5 ? pad(m.target as string) : kind === 6 ? (`${(m.jurisdiction as string).padEnd(66, '0')}` as Hex) : kind === 7 ? pad(m.attester as string) : pad(0);
    return BigInt(await this.pub.readContract({ address: this.d.mandateHook, abi: MandateHookAbi, functionName: 'nonces', args: [HOOK_NONCE_KIND[kind]!, key] }));
  }
}

function errorName(e: unknown): string {
  let cur: unknown = e;
  for (let i = 0; i < 10 && cur; i++) {
    const data = (cur as { data?: unknown }).data;
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
      for (const abi of [MandateHookAbi, AnchorAbi]) {
        try {
          return decodeErrorResult({ abi, data: data as Hex }).errorName;
        } catch {
          // try the next ABI
        }
      }
      return data.slice(0, 10);
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return (e as Error).message?.split('\n')[0] ?? 'unknown';
}
