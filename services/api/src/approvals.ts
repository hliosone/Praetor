// Tier-2 approvals (spec 06 F6): mcp opens a request when the hook answers T2; the owner approves the exact call with
// a passkey (web) or SOTER (mini program, through the attester TEE); the api registers the approval on-chain through
// the bundler and has mcp resubmit the same call with the agent key. "What you see is what you sign": a request carries
// the full preimage so the client recomputes the digest itself.
import { randomBytes, randomUUID } from 'node:crypto';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { digest, passkeyAuth, praetorDomain, soterAuth, soterChallenge, type OwnerAuth, type Tier2Approval } from '@praetor/protocol';
import { toWebAuthnAuth, type AssertionJSON } from './assertion.js';

export type Call = { to: Address; value: bigint; data: Hex };
export type ApprovalState = 'pending' | 'executed' | 'failed' | 'rejected' | 'expired';
export type ApprovalRow = {
  id: string; account: string; calls: string; callHash: Hex; nonce: string; expiresAt: string; digest: Hex; reason: string; summary: string;
  state: ApprovalState; channel: string | null; registerTx: Hex | null; executeTx: Hex | null;
};

export interface ApprovalStore {
  put(r: ApprovalRow): Promise<void>;
  get(id: string): Promise<ApprovalRow | undefined>;
  list(account: string, state?: ApprovalState): Promise<ApprovalRow[]>;
  update(id: string, patch: Partial<ApprovalRow>): Promise<void>;
}

export class MemoryApprovalStore implements ApprovalStore {
  rows = new Map<string, ApprovalRow>();
  async put(r: ApprovalRow) { this.rows.set(r.id, { ...r }); }
  async get(id: string) { const r = this.rows.get(id); return r ? { ...r } : undefined; }
  async list(account: string, state?: ApprovalState) { return [...this.rows.values()].filter((r) => r.account === account.toLowerCase() && (!state || r.state === state)); }
  async update(id: string, patch: Partial<ApprovalRow>) { const r = this.rows.get(id); if (r) Object.assign(r, patch); }
}

export type ApprovalDeps = {
  store: ApprovalStore;
  domain: { name: string; hook: Address };
  now(): Promise<bigint>;
  credIdHashOf(account: Address): Promise<Hex>;
  bundler: { tx(to: Address, data: Hex): Promise<{ txHash: Hex | null; success: boolean }> };
  /** mcp resubmits the call with the agent key (the only holder of a sign-userop right). */
  resubmit(account: Address, calls: Call[]): Promise<{ success: boolean; txHash: Hex | null }>;
  attester: { approve(b: Record<string, unknown>): Promise<{ soterApproval: Record<string, string>; attesterSig: Hex }> };
  /** The owner's channels (notifier): never blocks the request. */
  notify?(n: { account: Address; kind: string; text: string; link?: string }): Promise<void>;
  publicUrl?: string;
};

const TTL_S = 900n;
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

export class Approvals {
  constructor(private readonly d: ApprovalDeps) {}

  private tier2(r: ApprovalRow): Tier2Approval {
    return { account: r.account as Address, callHash: r.callHash, nonce: BigInt(r.nonce), expiresAt: BigInt(r.expiresAt) };
  }

  async request(b: { account: Address; calls: Call[]; callHash: Hex; reason: string; summary: string }): Promise<{ id: string }> {
    const t: Tier2Approval = { account: b.account, callHash: b.callHash, nonce: BigInt(`0x${randomBytes(8).toString('hex')}`), expiresAt: (await this.d.now()) + TTL_S };
    const row: ApprovalRow = {
      id: randomUUID(), account: b.account.toLowerCase(), calls: json(b.calls), callHash: b.callHash, nonce: t.nonce.toString(), expiresAt: t.expiresAt.toString(),
      digest: digest(praetorDomain(this.d.domain.name, this.d.domain.hook), 'Tier2Approval', t), reason: b.reason, summary: b.summary,
      state: 'pending', channel: null, registerTx: null, executeTx: null,
    };
    await this.d.store.put(row);
    await this.d.notify?.({ account: b.account, kind: 'approval', text: `Approve? ${b.summary}`, link: `${(this.d.publicUrl ?? '').replace(/\/$/, '')}/approve/${row.id}` }).catch(() => undefined);
    return { id: row.id };
  }

  private view(r: ApprovalRow) {
    return {
      id: r.id, state: r.state, reason: r.reason, summary: r.summary, digest: r.digest, channel: r.channel, registerTx: r.registerTx, executeTx: r.executeTx,
      calls: JSON.parse(r.calls) as { to: Address; value: string; data: Hex }[],
      tier2: { account: r.account, callHash: r.callHash, nonce: r.nonce, expiresAt: r.expiresAt },
      soterChallenge: soterChallenge(r.digest),
    };
  }

  async get(account: Address, id: string) {
    const r = await this.d.store.get(id);
    return r && r.account === account.toLowerCase() ? this.view(r) : null;
  }

  async list(account: Address, state?: ApprovalState) {
    return (await this.d.store.list(account, state)).map((r) => this.view(r));
  }

  async reject(account: Address, id: string) {
    const r = await this.pendingRow(account, id);
    await this.d.store.update(r.id, { state: 'rejected' });
  }

  private async pendingRow(account: Address, id: string): Promise<ApprovalRow> {
    const r = await this.d.store.get(id);
    if (!r || r.account !== account.toLowerCase()) throw new Error('unknown approval request');
    if (r.state !== 'pending') throw new Error('approval request not pending');
    if (BigInt(r.expiresAt) <= (await this.d.now())) {
      await this.d.store.update(id, { state: 'expired' });
      throw new Error('approval request expired');
    }
    return r;
  }

  private async register(r: ApprovalRow, auth: OwnerAuth, channel: string) {
    const data = encodeFunctionData({ abi: MandateHookAbi, functionName: 'registerApproval', args: [this.tier2(r), auth] as never });
    const reg = await this.d.bundler.tx(this.d.domain.hook, data);
    if (!reg.success) {
      await this.d.store.update(r.id, { state: 'failed', channel, registerTx: reg.txHash });
      return { state: 'failed' as const, registerTx: reg.txHash };
    }
    const calls = (JSON.parse(r.calls) as { to: Address; value: string; data: Hex }[]).map((c) => ({ to: c.to, value: BigInt(c.value), data: c.data }));
    const ex = await this.d.resubmit(r.account as Address, calls);
    const state = ex.success ? 'executed' : 'failed';
    await this.d.store.update(r.id, { state, channel, registerTx: reg.txHash, executeTx: ex.txHash });
    return { state, registerTx: reg.txHash, executeTx: ex.txHash };
  }

  async approveWithPasskey(account: Address, id: string, assertion: AssertionJSON) {
    const r = await this.pendingRow(account, id);
    return this.register(r, passkeyAuth(await this.d.credIdHashOf(account), toWebAuthnAuth(assertion, r.digest)), 'passkey');
  }

  async approveWithSoter(account: Address, id: string, b: { code: string; resultJSON: string; resultJSONSignature: string; authMode: string }) {
    const r = await this.pendingRow(account, id);
    const p = await this.d.attester.approve({ ...b, account, digestHex: soterChallenge(r.digest), expiresAt: Number(r.expiresAt) });
    const s = p.soterApproval;
    const auth = soterAuth({ account: s.account as Address, digest: s.digest as Hex, bindingHash: s.bindingHash as Hex, soterCounter: BigInt(s.soterCounter!), expiresAt: BigInt(s.expiresAt!) }, p.attesterSig);
    return this.register(r, auth, 'soter');
  }
}
