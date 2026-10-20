import { describe, it, expect } from 'vitest';
import { translate } from '../i18n/index.js';
import en from '../i18n/en.json';
import zh from '../i18n/zh-CN.json';
import { derToRs } from './staffKey.js';
import { defaultPolicy, policyFromJson } from './policy.js';
import { usd } from './api.js';
import { encodeAbiParameters, keccak256 } from 'viem';
import { digest, encodePolicy, praetorDomain } from '@praetor/protocol';
import { checkOwnerAction } from './ownerAction.js';
import { vapidKeyBytes } from './push.js';

const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

/** A DER ECDSA signature of (r, s), as WebAuthn returns it. */
function der(r: bigint, s: bigint) {
  const int = (v: bigint) => {
    let b = Array.from(Buffer.from(v.toString(16).padStart(64, '0'), 'hex'));
    while (b.length > 1 && b[0] === 0) b = b.slice(1);
    if (b[0]! & 0x80) b = [0, ...b];
    return [0x02, b.length, ...b];
  };
  const body = [...int(r), ...int(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

describe('web app logic', () => {
  it('translates with placeholders, falls back to English, then to the key', () => {
    expect(translate('en', 'phone.approve', { amount: '300' })).toBe('Approve 300 USDC');
    expect(translate('zh-CN', 'phone.approve', { amount: '300' })).toBe('批准 300 USDC');
    expect(translate('zh-CN', 'no.such.key')).toBe('no.such.key');
  });

  it('has every English string in Chinese', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('turns a DER signature into (r, s) with a low s, as the member services require', () => {
    const r = 0x1234n;
    const low = 0x5678n;
    expect(derToRs(der(r, low))).toEqual({ r: `0x${r.toString(16).padStart(64, '0')}`, s: `0x${low.toString(16).padStart(64, '0')}` });
    expect(derToRs(der(r, N - low)).s).toBe(`0x${low.toString(16).padStart(64, '0')}`);
  });

  it('proposes the mandate of the Lin persona as a first policy, valid for a year', () => {
    const c = { chainId: 84532, domainName: 'Praetor-local', mandateHook: '0x01', usdc: '0x02', txau: '0x03', txag: '0x04', deskSpreadBps: 30 } as never;
    const p = defaultPolicy(c, 1_800_000_000);
    expect(p).toMatchObject({ autoCap: '200000000', hardCap: '2000000000', validUntil: String(1_800_000_000 + 365 * 86_400) });
    expect(p.bands.map((b) => [b.minBps, b.targetBps, b.maxBps])).toEqual([[4000, 5500, 6000], [2000, 3000, 3500], [0, 1500, 1500]]);
  });

  it('scales the first policy to the live demo scale, with a 1 USDC buffer the demo funds can keep (a tester\'s payments were all BUFFER_BREACH)', () => {
    const c = { chainId: 84532, domainName: 'Praetor', mandateHook: '0x01', usdc: '0x02', txau: '0x03', txag: '0x04', deskSpreadBps: 30, demoScale: 100 } as never;
    const p = defaultPolicy(c, 1_800_000_000);
    expect(p).toMatchObject({ autoCap: '2000000', hardCap: '20000000', dailyBudget: '5000000', monthlyBudget: '30000000', bufferUsdc: '1000000', maxTradeUsd: '10000000' });
    expect(p.bands.map((b) => [b.minBps, b.targetBps, b.maxBps])).toEqual([[4000, 5500, 6000], [2000, 3000, 3500], [0, 1500, 1500]]);
  });

  it('formats USD amounts of 6 decimals', () => {
    expect(usd('1234560000')).toMatch(/1.?234\.56/);
  });

  it('signs an owner action only when its digest, kind, account and payload hash are what the page asked for', () => {
    const cfg = { domainName: 'Praetor-test', mandateHook: '0x00000000000000000000000000000000000000aa' } as const;
    const account = '0x00000000000000000000000000000000000c0ffe' as const;
    const payload = encodeAbiParameters([{ type: 'uint32' }], [7]);
    const oa = { account, action: 2, payloadHash: keccak256(payload), nonce: '3', expiresAt: '1800000000', fiscoRef: `0x${'00'.repeat(32)}` as const };
    const d = digest(praetorDomain(cfg.domainName, cfg.mandateHook), 'OwnerAction', { ...oa, nonce: 3n, expiresAt: 1_800_000_000n });
    expect(checkOwnerAction({ ownerAction: oa, payload, digest: d }, cfg, account, 2)).toBe(d);
    expect(() => checkOwnerAction({ ownerAction: oa, payload, digest: keccak256('0x01') }, cfg, account, 2)).toThrow(/digest/);
    expect(() => checkOwnerAction({ ownerAction: oa, payload, digest: d }, cfg, account, 7)).toThrow(/kind/);
    expect(() => checkOwnerAction({ ownerAction: oa, payload, digest: d }, cfg, '0x00000000000000000000000000000000000000bb', 2)).toThrow(/account/);
    expect(() => checkOwnerAction({ ownerAction: oa, payload: encodeAbiParameters([{ type: 'uint32' }], [8]), digest: d }, cfg, account, 2)).toThrow(/payload/);
  });

  it('signs a policy only when the payload is the policy on the page', () => {
    const c = { chainId: 84532, domainName: 'Praetor-test', mandateHook: '0x00000000000000000000000000000000000000aa', usdc: '0x0000000000000000000000000000000000000002', txau: '0x0000000000000000000000000000000000000003', txag: '0x0000000000000000000000000000000000000004', deskSpreadBps: 30 } as const;
    const account = '0x00000000000000000000000000000000000c0ffe' as const;
    const form = defaultPolicy(c, 1_800_000_000);
    const payload = encodePolicy(policyFromJson(form));
    const oa = { account, action: 0, payloadHash: keccak256(payload), nonce: '1', expiresAt: '1800000000', fiscoRef: `0x${'00'.repeat(32)}` as const };
    const d = digest(praetorDomain(c.domainName, c.mandateHook), 'OwnerAction', { ...oa, nonce: 1n, expiresAt: 1_800_000_000n });
    expect(checkOwnerAction({ ownerAction: oa, payload, digest: d }, c, account, 0, payload)).toBe(d);
    const other = encodePolicy(policyFromJson({ ...form, hardCap: '9000000000' }));
    expect(() => checkOwnerAction({ ownerAction: oa, payload, digest: d }, c, account, 0, other)).toThrow(/not the one on this page/);
  });

  it('turns the VAPID public key (base64url, 65 bytes uncompressed P-256) into the bytes PushManager.subscribe takes', () => {
    const raw = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
    const b64url = Buffer.from(raw).toString('base64url');
    expect(Array.from(vapidKeyBytes(b64url))).toEqual(Array.from(raw));
    expect(() => vapidKeyBytes('')).toThrow(/VAPID/);
  });
});
