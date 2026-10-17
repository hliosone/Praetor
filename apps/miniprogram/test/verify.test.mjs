// What the mini program refuses to sign (spec 05 "what you see is what you sign", spec 06 F2 and F6): requests are
// built here with packages/protocol (an independent implementation) and then tampered with, one field at a time.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { encodeFunctionData, erc20Abi, keccak256, encodeAbiParameters, parseAbi } from 'viem';
import { callHash, digest, praetorDomain, OwnerActionKind } from '@praetor/protocol';

const require = createRequire(import.meta.url);
const calls = require('../miniprogram/lib/calls.js');
const verify = require('../miniprogram/lib/verify.js');
const soter = require('../miniprogram/lib/soter.js');
const p = require('../miniprogram/lib/protocol.js');

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const HOOK = '0x00000000000000000000000000000000000000aa';
const CFG = {
  chainId: 84532, domainName: 'Praetor-local', mandateHook: HOOK,
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', txau: '0x00000000000000000000000000000000000000a2', txag: '0x00000000000000000000000000000000000000a3',
  treasuryDesk: '0x00000000000000000000000000000000000000d1', payoutRail: '0x00000000000000000000000000000000000000e1',
};
const CAFE = '0x1111111111111111111111111111111111111111';
const NOW = 1_800_000_000;
const DESK = parseAbi(['function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)']);
const RAIL = parseAbi(['function pay(address partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)']);

function approvalView(over = {}) {
  const call = { to: CFG.usdc, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [CAFE, 300_000_000n] }) };
  const ch = callHash({ account: ACCOUNT, target: call.to, value: 0n, data: call.data });
  const tier2 = { account: ACCOUNT, callHash: ch, nonce: '1311768467463790320', expiresAt: String(NOW + 900) };
  const d = digest(praetorDomain('Praetor-local', HOOK), 'Tier2Approval', { ...tier2, nonce: BigInt(tier2.nonce), expiresAt: BigInt(tier2.expiresAt) });
  return { id: 'a1', state: 'pending', reason: 'UNKNOWN_PAYEE', summary: 'Pay 3 USDC to Landlord', digest: d, soterChallenge: d.slice(2), calls: [call], tier2, ...over };
}

describe('calls: decoding what an approval covers', () => {
  it('a USDC transfer: full payee address and exact amount', () => {
    const d = calls.decodeCall(approvalView().calls[0], CFG);
    expect(d).toMatchObject({ kind: 'transfer', to: CAFE, amount: '300000000', token: { symbol: 'USDC', decimals: 6 } });
    expect(calls.describe('en', d)).toBe(`Pay 300 USDC to ${CAFE}`);
    expect(calls.describe('zh-CN', d, { short: true })).toBe('向 0x1111…1111 支付 300 USDC');
  });

  it('the rebalance pair: approve the desk, then swap with a minimum out', () => {
    const approve = calls.decodeCall({ to: CFG.txau, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CFG.treasuryDesk, 250_000_000_000_000_000n] }) }, CFG);
    expect(calls.describe('en', approve)).toBe('Let the treasury desk take 0.25 tXAU');
    const swap = calls.decodeCall({ to: CFG.treasuryDesk, value: '0', data: encodeFunctionData({ abi: DESK, functionName: 'swap', args: [CFG.txau, CFG.usdc, 250_000_000_000_000_000n, 650_000_000n] }) }, CFG);
    expect(calls.describe('en', swap)).toBe('Swap 0.25 tXAU for at least 650 USDC');
  });

  it('a payout through the rail names the rail and keeps the references', () => {
    const ref = keccak256('0x01');
    const d = calls.decodeCall({ to: CFG.payoutRail, value: '0', data: encodeFunctionData({ abi: RAIL, functionName: 'pay', args: [CAFE, 1_200_000_000n, 1, ref, ref] }) }, CFG);
    expect(d).toMatchObject({ kind: 'payout', partner: CAFE, rail: 'ALIPAY_PLUS', merchantRef: ref });
    expect(calls.describe('en', d)).toBe('Pay 1,200 USDC by Alipay+');
  });

  it('shows anything not encoded exactly as a raw call (extra bytes, dirty address word, unknown selector), and flags ETH value', () => {
    const good = approvalView().calls[0].data;
    expect(calls.decodeCall({ to: CFG.usdc, value: '0', data: `${good}00` }, CFG).kind).toBe('unknown');
    expect(calls.decodeCall({ to: CFG.usdc, value: '0', data: `0xa9059cbb${'ff'.repeat(12)}${CAFE.slice(2)}${'00'.repeat(32)}` }, CFG).kind).toBe('unknown');
    const raw = calls.decodeCall({ to: CFG.usdc, value: '0', data: '0xdeadbeef' }, CFG);
    expect(calls.describe('en', raw)).toBe(`Call 0xdeadbeef on ${CFG.usdc}`);
    expect(calls.describe('en', calls.decodeCall({ ...approvalView().calls[0], value: '5' }, CFG))).toBe(`Pay 300 USDC to ${CAFE} and send 5 wei of ETH`);
  });

  it('pins the selectors it decodes to their signatures', () => {
    const sel = (s) => p.keccak256(new Uint8Array(Buffer.from(s))).slice(0, 10);
    expect(calls.SELECTORS).toEqual({
      [sel('transfer(address,uint256)')]: 'transfer', [sel('approve(address,uint256)')]: 'approve',
      [sel('swap(address,address,uint256,uint256)')]: 'swap', [sel('pay(address,uint256,uint8,bytes32,bytes32)')]: 'pay',
    });
  });
});

describe('checkApproval (F6 step 5a): the digest is recomputed from what is shown', () => {
  const ctx = { config: CFG, account: ACCOUNT, nowS: NOW, lang: 'en' };

  it('a genuine request: ok, the challenge is the locally computed digest, the Face ID text comes from the decoded call', () => {
    const v = approvalView();
    const r = verify.checkApproval(v, ctx);
    expect(r).toMatchObject({ ok: true, problems: [], closed: null, digest: v.digest, challenge: v.digest.slice(2), callIndex: 0 });
    expect(r.authContent).toBe('Approve: Pay 300 USDC to 0x1111…1111');
    expect(r.authContent).not.toContain('Landlord');
  });

  it('never uses the server\'s soterChallenge', () => {
    const r = verify.checkApproval(approvalView({ soterChallenge: 'ab'.repeat(32) }), ctx);
    expect(r.challenge).toBe(approvalView().digest.slice(2));
  });

  it('refuses a digest that does not match the shown request', () => {
    expect(verify.checkApproval(approvalView({ digest: keccak256('0x02') }), ctx).problems).toEqual(['digest']);
  });

  it('refuses when the shown call is not the one the call hash binds (amount changed after hashing)', () => {
    const v = approvalView();
    const other = { ...v.calls[0], data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [CAFE, 3_000_000n] }) };
    expect(verify.checkApproval({ ...v, calls: [other] }, ctx).problems).toEqual(['callhash']);
  });

  it('refuses a request for another account than the signed-in one', () => {
    expect(verify.checkApproval(approvalView(), { ...ctx, account: '0x00000000000000000000000000000000000000bb' }).problems).toContain('account');
  });

  it('refuses what it cannot encode exactly', () => {
    const v = approvalView();
    expect(verify.checkApproval({ ...v, tier2: { ...v.tier2, nonce: '-1' } }, ctx).problems).toContain('malformed');
    expect(verify.checkApproval({ ...v, calls: [] }, ctx).problems).toContain('callhash');
  });

  it('a decided or expired request is closed, with no challenge', () => {
    expect(verify.checkApproval(approvalView({ state: 'executed' }), ctx)).toMatchObject({ ok: false, closed: 'state', challenge: null });
    expect(verify.checkApproval(approvalView(), { ...ctx, nowS: NOW + 900 })).toMatchObject({ ok: false, closed: 'expired', challenge: null });
  });
});

function linkView(over = {}) {
  const linkNonce = keccak256('0x0bad');
  const payloadHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [linkNonce]));
  const ownerAction = { account: ACCOUNT, action: OwnerActionKind.LINK_WECHAT, payloadHash, nonce: '42', expiresAt: String(NOW + 600), fiscoRef: `0x${'00'.repeat(32)}` };
  const d = digest(praetorDomain('Praetor-local', HOOK), 'OwnerAction', { ...ownerAction, nonce: 42n, expiresAt: BigInt(ownerAction.expiresAt) });
  return { account: ACCOUNT, ownerAction, linkNonce, digest: d, soterChallenge: d.slice(2), state: 'waiting', ...over };
}

describe('checkLink (F2 step 3)', () => {
  const ctx = { config: CFG, nowS: NOW, lang: 'en' };

  it('a genuine LINK_WECHAT request: ok, challenge from the local digest', () => {
    const v = linkView();
    expect(verify.checkLink(v, ctx)).toMatchObject({ ok: true, problems: [], digest: v.digest, challenge: v.digest.slice(2), account: ACCOUNT, authContent: 'Link WeChat to 0x0000…0ffe' });
  });

  it('refuses another owner action shown as a link (e.g. CANCEL_RECOVERY, which SOTER can sign)', () => {
    const v = linkView();
    const forged = { ...v.ownerAction, action: OwnerActionKind.CANCEL_RECOVERY };
    const d = digest(praetorDomain('Praetor-local', HOOK), 'OwnerAction', { ...forged, nonce: 42n, expiresAt: BigInt(forged.expiresAt) });
    expect(verify.checkLink({ ...v, ownerAction: forged, digest: d }, ctx).problems).toEqual(['action']);
  });

  it('refuses a payload hash that is not keccak256(abi.encode(linkNonce)), or a missing nonce', () => {
    expect(verify.checkLink(linkView({ linkNonce: keccak256('0x01') }), ctx).problems).toEqual(['payload']);
    expect(verify.checkLink(linkView({ linkNonce: undefined }), ctx).problems).toEqual(['payload']);
  });

  it('refuses a digest that does not match, and a view whose account differs from the action', () => {
    expect(verify.checkLink(linkView({ digest: keccak256('0x03') }), ctx).problems).toEqual(['digest']);
    expect(verify.checkLink(linkView({ account: '0x00000000000000000000000000000000000000bb' }), ctx).problems).toEqual(['malformed']);
  });

  it('a used or expired QR code is closed', () => {
    expect(verify.checkLink(linkView({ state: 'scanned' }), ctx).closed).toBe('state');
    expect(verify.checkLink(linkView(), { ...ctx, nowS: NOW + 600 }).closed).toBe('expired');
  });

  it('reads the request id from the web app QR code, and nothing else', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(verify.linkIdFromQr(`https://praetor.localhost/mp/link?id=${id}`)).toBe(id);
    expect(verify.linkIdFromQr(id)).toBe(id);
    expect(verify.linkIdFromQr('https://evil.example/mp/link?id=../../approvals')).toBeNull();
    expect(verify.linkIdFromQr('weixin://something')).toBeNull();
  });
});

describe('SOTER on the phone', () => {
  it('takes the mode from supportMode: Face ID first, else fingerprint, else none', () => {
    expect(soter.pickMode(['fingerPrint', 'facial'])).toBe('facial');
    expect(soter.pickMode(['fingerPrint'])).toBe('fingerPrint');
    expect(soter.pickMode(['speech'])).toBeNull();
    expect(soter.pickMode(undefined)).toBeNull();
  });

  it('asks WeChat to sign the challenge, and keeps the result only if raw is that challenge', () => {
    const challenge = 'ab'.repeat(32);
    expect(soter.startOptions('facial', challenge, 'Approve: x')).toEqual({ requestAuthModes: ['facial'], challenge, authContent: 'Approve: x' });
    const resultJSON = JSON.stringify({ raw: challenge, counter: 3, uid: 'u', cpu_id: 'c' });
    expect(soter.checkResult({ errCode: 0, authMode: 'facial', resultJSON, resultJSONSignature: 'sig' }, challenge)).toEqual({ authMode: 'facial', resultJSON, resultJSONSignature: 'sig' });
    expect(() => soter.checkResult({ errCode: 0, authMode: 'facial', resultJSON: JSON.stringify({ raw: 'cd'.repeat(32) }), resultJSONSignature: 's' }, challenge)).toThrow(/raw/);
    expect(() => soter.checkResult({ errCode: 90008, errMsg: 'user cancel' }, challenge)).toThrow(/90008/);
  });
});
