// F2 (spec 06): link the user's WeChat (its SOTER binding) to the account. The web app starts a LINK_WECHAT owner
// action whose digest only depends on a fresh linkNonce; the mini program scans the QR, runs SOTER over that digest
// and the attester TEE turns the result into a proof; the owner then confirms the same digest with the passkey, and the
// bank co-signs. The request id is the mini program's capability. When the mini program is signed in (spec 05), the
// proof must bind the WeChat user of its session, and that user's link is recorded once LINK_WECHAT succeeded on Base.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { soterChallenge, OwnerActionKind as K, type OwnerAction, type SoterApproval } from '@praetor/protocol';
import { ownerActionPayload } from '@praetor/protocol';
import type { OwnerActions } from './owner-actions.js';
import type { AssertionJSON } from './assertion.js';
import { HttpError } from './app.js';

type Link = {
  id: string; account: Address; linkNonce: Hex; ownerAction: OwnerAction; digest: Hex; proof?: SoterApproval; attesterSig?: Hex; openidHash?: Hex;
  state: 'waiting' | 'scanned' | 'linked';
};

const PLACEHOLDER: SoterApproval = { account: '0x0000000000000000000000000000000000000000', digest: `0x${'00'.repeat(32)}`, bindingHash: `0x${'00'.repeat(32)}`, soterCounter: 0n, expiresAt: 0n };

export class WechatLink {
  private links = new Map<string, Link>();

  constructor(private readonly d: {
    ownerActions: OwnerActions;
    publicUrl: string;
    attester: { approve(b: Record<string, unknown>): Promise<{ soterApproval: Record<string, string>; attesterSig: Hex }> };
    /** LINK_WECHAT succeeded on Base for a scan made by a signed-in mini program. */
    onLinked?(x: { account: Address; openidHash: Hex; bindingHash: Hex }): Promise<void>;
  }) {}

  async start(account: Address) {
    const linkNonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    // The digest depends only on linkNonce (spec 02): the proof joins the payload at confirmation.
    const p = await this.d.ownerActions.prepare(account, { kind: K.LINK_WECHAT, account, linkNonce, proof: PLACEHOLDER, attesterSig: '0x' });
    const id = randomUUID();
    this.links.set(id, { id, account, linkNonce, ownerAction: p.ownerAction, digest: p.digest, state: 'waiting' });
    return { id, digest: p.digest, qr: `${this.d.publicUrl.replace(/\/$/, '')}/mp/link?id=${id}` };
  }

  private link(id: string) {
    const l = this.links.get(id);
    if (!l) throw new Error('unknown link request');
    return l;
  }

  /** What the mini program shows and recomputes before running SOTER. */
  async view(id: string) {
    const l = this.link(id);
    return { account: l.account, ownerAction: l.ownerAction, linkNonce: l.linkNonce, digest: l.digest, soterChallenge: soterChallenge(l.digest), state: l.state };
  }

  /** `session`: the signed-in mini program's WeChat user and the binding its SOTER result should give (spec 05). */
  async soter(id: string, b: { code: string; resultJSON: string; resultJSONSignature: string; authMode: string }, session?: { openidHash: Hex; bindingHash: Hex }) {
    const l = this.link(id);
    if (l.state !== 'waiting') throw new Error('link request already scanned');
    const p = await this.d.attester.approve({ ...b, account: l.account, digestHex: soterChallenge(l.digest), expiresAt: Number(l.ownerAction.expiresAt) });
    const s = p.soterApproval;
    if (session && String(s.bindingHash).toLowerCase() !== session.bindingHash.toLowerCase()) throw new HttpError(403, 'the SOTER result comes from another WeChat user than the signed-in one');
    l.proof = { account: s.account as Address, digest: s.digest as Hex, bindingHash: s.bindingHash as Hex, soterCounter: BigInt(s.soterCounter!), expiresAt: BigInt(s.expiresAt!) };
    l.attesterSig = p.attesterSig;
    l.openidHash = session?.openidHash;
    l.state = 'scanned';
    return { state: l.state };
  }

  async status(account: Address, id: string) {
    const l = this.links.get(id);
    if (!l || l.account.toLowerCase() !== account.toLowerCase()) throw new Error('unknown link request');
    return { state: l.state };
  }

  async confirm(account: Address, id: string, assertion: AssertionJSON) {
    const l = this.links.get(id);
    if (!l || l.account.toLowerCase() !== account.toLowerCase()) throw new Error('unknown link request');
    if (l.state !== 'scanned' || !l.proof || !l.attesterSig) throw new Error('WeChat has not scanned yet');
    const { payload } = ownerActionPayload({ kind: K.LINK_WECHAT, account, linkNonce: l.linkNonce, proof: l.proof, attesterSig: l.attesterSig });
    const r = await this.d.ownerActions.submit(account, { ownerAction: l.ownerAction, payload, assertion });
    if (r.success) {
      // Recorded before the state turns "linked": the mini program signs in again as soon as it reads that state.
      if (l.openidHash) await this.d.onLinked?.({ account, openidHash: l.openidHash, bindingHash: l.proof.bindingHash });
      l.state = 'linked';
    }
    return r;
  }
}
