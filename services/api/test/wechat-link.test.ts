import { describe, it, expect } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem';
import { MandateHookAbi } from '@praetor/chain';
import { softPasskey, soterChallenge, OwnerActionKind as K } from '@praetor/protocol';
import { OwnerActions } from '../src/owner-actions.js';
import { WechatLink } from '../src/wechat-link.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const HOOK = '0x00000000000000000000000000000000000000aa' as Address;
const pk = softPasskey('wechat-link', 'praetor.localhost', 'https://praetor.localhost');
const b64 = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64url');

function setup(o: { onLinked?: (x: { account: Address; openidHash: Hex; bindingHash: Hex }) => Promise<void>; success?: boolean } = {}) {
  const tx: Hex[] = [];
  const approvals: Record<string, unknown>[] = [];
  const oa = new OwnerActions({
    domain: { name: 'Praetor-test', hook: HOOK }, now: async () => 1_800_000_000n, credIdHashOf: async () => pk.credIdHash,
    bank: { cosign: async () => ({ bankSig: '0xbb' as Hex }) },
    bundler: { tx: async (_to, data) => { tx.push(data); return { txHash: `0x${'11'.repeat(32)}` as Hex, success: o.success ?? true }; } },
  });
  const link = new WechatLink({
    ownerActions: oa, publicUrl: 'https://praetor.localhost', onLinked: o.onLinked,
    attester: { approve: async (b) => { approvals.push(b); return { soterApproval: { account: ACCOUNT, digest: `0x${String(b.digestHex)}`, bindingHash: `0x${'33'.repeat(32)}`, soterCounter: '4', expiresAt: String(b.expiresAt) }, attesterSig: '0xabcd' as Hex }; } },
  });
  return { link, tx, approvals };
}

describe('F2 link WeChat', () => {
  it('start -> mini program SOTER over the digest -> owner passkey -> LINK_WECHAT with the proof and the bank', async () => {
    const { link, tx, approvals } = setup();
    const s = await link.start(ACCOUNT);
    expect(s.qr).toBe(`https://praetor.localhost/mp/link?id=${s.id}`);
    const view = await link.view(s.id);
    expect(view.digest).toBe(s.digest);
    expect(view.ownerAction.action).toBe(K.LINK_WECHAT);
    expect((await link.status(ACCOUNT, s.id)).state).toBe('waiting');
    await link.soter(s.id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' });
    expect(approvals[0]).toMatchObject({ account: ACCOUNT, digestHex: soterChallenge(s.digest) });
    expect((await link.status(ACCOUNT, s.id)).state).toBe('scanned');
    const r = await link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)));
    expect(r.success).toBe(true);
    const call = decodeFunctionData({ abi: MandateHookAbi, data: tx[0]! });
    const payload = (call.args as unknown as unknown[])[1] as Hex;
    const [nonce] = decodeAbiParameters([{ type: 'bytes32' }], payload);
    expect(keccak256(toHex(nonce))).not.toBe('0x');
    expect((await link.status(ACCOUNT, s.id)).state).toBe('linked');
  });

  it('the view carries linkNonce, so the mini program can check payloadHash = keccak256(abi.encode(linkNonce))', async () => {
    const { link } = setup();
    const s = await link.start(ACCOUNT);
    const view = await link.view(s.id);
    expect(keccak256(view.linkNonce)).toBe(view.ownerAction.payloadHash);
  });

  it('a signed-in mini program: the attester binding must be the one its WeChat user gives; recorded once linked on Base', async () => {
    const linked: unknown[] = [];
    const { link } = setup({ onLinked: async (x) => { linked.push(x); } });
    const s = await link.start(ACCOUNT);
    const openidHash = keccak256(toHex('openid-a'));
    await link.soter(s.id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' }, { openidHash, bindingHash: `0x${'33'.repeat(32)}` });
    expect(linked).toEqual([]);
    await link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)));
    expect(linked).toEqual([{ account: ACCOUNT, openidHash, bindingHash: `0x${'33'.repeat(32)}` }]);
  });

  it('refuses a SOTER result from another WeChat user than the signed-in one, and stays waiting', async () => {
    const { link } = setup();
    const s = await link.start(ACCOUNT);
    await expect(link.soter(s.id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' }, { openidHash: keccak256(toHex('openid-a')), bindingHash: `0x${'44'.repeat(32)}` }))
      .rejects.toMatchObject({ status: 403 });
    expect((await link.status(ACCOUNT, s.id)).state).toBe('waiting');
  });

  it('nothing is recorded when the passkey confirmation fails on Base, nor for a scan without a mini program session', async () => {
    const linked: unknown[] = [];
    const failing = setup({ onLinked: async (x) => { linked.push(x); }, success: false });
    const s = await failing.link.start(ACCOUNT);
    await failing.link.soter(s.id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' }, { openidHash: keccak256(toHex('openid-a')), bindingHash: `0x${'33'.repeat(32)}` });
    expect((await failing.link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)))).success).toBe(false);
    const plain = setup({ onLinked: async (x) => { linked.push(x); } });
    const s2 = await plain.link.start(ACCOUNT);
    await plain.link.soter(s2.id, { code: 'c', resultJSON: '{}', resultJSONSignature: 'sig', authMode: 'facial' });
    expect((await plain.link.confirm(ACCOUNT, s2.id, pk.authentication(b64(s2.digest)))).success).toBe(true);
    expect(linked).toEqual([]);
  });

  it('cannot confirm before the phone scanned, nor for another account', async () => {
    const { link } = setup();
    const s = await link.start(ACCOUNT);
    await expect(link.confirm(ACCOUNT, s.id, pk.authentication(b64(s.digest)))).rejects.toThrow(/scanned/);
    await expect(link.status('0x00000000000000000000000000000000000000bb', s.id)).rejects.toThrow(/unknown/);
  });
});
