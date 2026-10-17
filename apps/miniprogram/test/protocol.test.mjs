// lib/protocol.js: the digests the mini program recomputes before it runs SOTER, asserted against the golden vectors of
// packages/protocol, loaded as the mini program loads it, and compared with the TypeScript implementation on random
// inputs (spec 07: "tested against the same vectors").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { transform } from 'esbuild';
import * as ts from '@praetor/protocol';
import { buildProtocol } from '../scripts/build-protocol.mjs';
import { MP, loadIsolated, vector } from './load.mjs';

const p = loadIsolated('lib/protocol.js');
const TEST_DOMAIN = { name: 'Praetor-test', version: '1', chainId: 84532, verifyingContract: '0x00000000000000000000000000000000DeaDBeef' };

describe('lib/protocol.js against the golden vectors', () => {
  it('callHash: every case of callhash.json (empty data, ETH value)', () => {
    const cases = vector('callhash');
    expect(cases).toHaveLength(4);
    for (const c of cases) expect(p.callHash({ account: c.account, target: c.target, value: c.value, data: c.data })).toBe(c.callHash);
  });

  it('Tier2Approval: type string, typehash, encoding, struct hash and digest', () => {
    const v = vector('tier2-approval');
    expect(v.domain).toEqual(TEST_DOMAIN);
    expect(p.encodeType('Tier2Approval')).toBe(v.encodeType);
    expect(p.typehash('Tier2Approval')).toBe(v.typehash);
    expect(p.encodeStruct('Tier2Approval', v.message)).toBe(v.encoded);
    expect(p.structHash('Tier2Approval', v.message)).toBe(v.structHash);
    expect(p.digest(v.domain, 'Tier2Approval', v.message)).toBe(v.digest);
  });

  it('OwnerAction: type string, typehash, encoding, struct hash and digest', () => {
    const v = vector('owner-action');
    expect(p.encodeType('OwnerAction')).toBe(v.encodeType);
    expect(p.typehash('OwnerAction')).toBe(v.typehash);
    expect(p.encodeStruct('OwnerAction', v.message)).toBe(v.encoded);
    expect(p.structHash('OwnerAction', v.message)).toBe(v.structHash);
    expect(p.digest(v.domain, 'OwnerAction', v.message)).toBe(v.digest);
  });

  it('LINK_WECHAT and UNLINK_WECHAT payload hashes', () => {
    const all = vector('owner-action-payloads');
    const link = all.find((x) => x.name === 'LINK_WECHAT');
    const unlink = all.find((x) => x.name === 'UNLINK_WECHAT');
    expect(p.linkPayloadHash(link.args.linkNonce)).toBe(link.payloadHash);
    expect(p.unlinkPayloadHash(unlink.args.bindingHash)).toBe(unlink.payloadHash);
    expect(p.OwnerActionKind.LINK_WECHAT).toBe(link.kind);
    expect(p.OwnerActionKind.UNLINK_WECHAT).toBe(unlink.kind);
  });

  it('SOTER challenge: the digest as 64 lowercase hex characters, no 0x', () => {
    const v = vector('tier2-approval');
    expect(p.soterChallenge(v.digest)).toBe(v.digest.slice(2).toLowerCase());
    expect(p.soterChallenge(v.digest.toUpperCase().replace('0X', '0x'))).toBe(v.digest.slice(2).toLowerCase());
    expect(() => p.soterChallenge('0x1234')).toThrow();
  });

  it('keccak256 of bytes and of hex', () => {
    expect(p.keccak256('0x')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(p.keccak256(new Uint8Array([0x61, 0x62, 0x63]))).toBe('0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });
});

describe('lib/protocol.js refuses what it cannot encode exactly', () => {
  const ok = { account: '0x000000000000000000000000000000000000a11c', callHash: `0x${'11'.repeat(32)}`, nonce: '1', expiresAt: '2' };
  it.each([
    ['a short address', { ...ok, account: '0x000000000000000000000000000000000000a11' }],
    ['a short bytes32', { ...ok, callHash: '0x1234' }],
    ['a uint64 at 2^64', { ...ok, nonce: '18446744073709551616' }],
    ['a negative number', { ...ok, expiresAt: '-1' }],
    ['a fractional number', { ...ok, expiresAt: 1.5 }],
    ['a missing field', { account: ok.account, callHash: ok.callHash, nonce: '1' }],
  ])('%s', (_, m) => {
    expect(() => p.structHash('Tier2Approval', m)).toThrow();
  });
  it('odd or non-hex call data, and an unknown type', () => {
    expect(() => p.callHash({ account: ok.account, target: ok.account, value: '0', data: '0x123' })).toThrow();
    expect(() => p.callHash({ account: ok.account, target: ok.account, value: '0', data: '0xzz' })).toThrow();
    expect(() => p.structHash('SoterApproval', ok)).toThrow();
  });
  it('accepts the largest uint64 and checksummed addresses', () => {
    const m = { ...ok, account: '0x00000000000000000000000000000000DeaDBeef', nonce: '18446744073709551615' };
    expect(p.structHash('Tier2Approval', m)).toBe(ts.structHash('Tier2Approval', { ...m, nonce: 2n ** 64n - 1n, expiresAt: 2n }));
  });
});

const hex = (n) => `0x${randomBytes(n).toString('hex')}`;
const u64 = () => BigInt(hex(8));

describe('lib/protocol.js equals packages/protocol on random inputs', () => {
  it('callHash, Tier2Approval and OwnerAction digests (200 rounds)', () => {
    for (let i = 0; i < 200; i++) {
      const account = hex(20);
      const target = hex(20);
      // The bundle compares addresses without case; the TypeScript side wants valid checksums, so it gets lower case.
      const shown = i % 3 === 0 ? target.toUpperCase().replace('0X', '0x') : target;
      const value = i % 5 === 0 ? 0n : BigInt(hex(i % 32 + 1));
      const data = i % 7 === 0 ? '0x' : hex(i % 70);
      expect(p.callHash({ account, target: shown, value: value.toString(), data })).toBe(ts.callHash({ account, target, value, data }));
      const domain = { name: ['Praetor', 'Praetor-local', 'Praetor-sandbox', 'Praetor-测试'][i % 4], version: '1', chainId: 84532, verifyingContract: hex(20) };
      const t2 = { account, callHash: hex(32), nonce: u64(), expiresAt: u64() };
      expect(p.digest(domain, 'Tier2Approval', { ...t2, nonce: t2.nonce.toString(), expiresAt: t2.expiresAt.toString() })).toBe(ts.digest(domain, 'Tier2Approval', t2));
      const oa = { account, action: i % 13, payloadHash: hex(32), nonce: u64(), expiresAt: u64(), fiscoRef: hex(32) };
      expect(p.digest(domain, 'OwnerAction', { ...oa, nonce: oa.nonce.toString(), expiresAt: oa.expiresAt.toString() })).toBe(ts.digest(domain, 'OwnerAction', oa));
    }
  });
});

describe('checksumAddress (EIP-55, for display)', () => {
  it('matches viem on Circle USDC and on random addresses, and refuses a non-address', async () => {
    const { getAddress } = await import('viem');
    expect(p.checksumAddress('0x036cbd53842c5426634e7929541ec2318f3dcf7e')).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    for (let i = 0; i < 50; i++) {
      const a = hex(20);
      expect(p.checksumAddress(a)).toBe(getAddress(a));
    }
    expect(() => p.checksumAddress('0x1234')).toThrow();
  });
});

describe('the bundle as shipped', () => {
  const code = readFileSync(new URL('lib/protocol.js', MP), 'utf8');

  it('has no BigInt literal (esbuild flags any below es2020: proven on a negative control)', async () => {
    const bigintLiterals = async (src) => (await transform(src, { target: 'es2019' })).warnings.filter((w) => /Big integer literal/.test(w.text)).length;
    expect(await bigintLiterals('const x = 1n;')).toBe(1);
    expect(await bigintLiterals(code)).toBe(0);
  });

  it('is exactly what the build produces from src/protocol.mjs (rebuild with `pnpm --filter @praetor/miniprogram build`)', async () => {
    expect(code).toBe(await buildProtocol());
  });

  it('is self-contained: it requires nothing (the mini program has no node_modules)', () => {
    expect(code).not.toMatch(/\brequire\(/);
  });
});
