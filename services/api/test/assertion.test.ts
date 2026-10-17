import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { softPasskey, P256_N } from '@praetor/protocol';
import { toWebAuthnAuth, toMemberAssertion } from '../src/assertion.js';

const pk = softPasskey('conv', 'praetor.localhost', 'https://praetor.localhost');
const digest = keccak256(toHex('an owner action digest'));
const b64 = (h: string) => Buffer.from(h.slice(2), 'hex').toString('base64url');

describe('browser assertion -> on-chain WebAuthnAuth', () => {
  it('keeps the exact bytes, finds the indexes, and the signature verifies on the hashed message with low s', () => {
    const json = pk.authentication(b64(digest));
    const a = toWebAuthnAuth(json, digest);
    expect(a.clientDataJSON).toBe(Buffer.from(json.response.clientDataJSON, 'base64url').toString('utf8'));
    expect(a.clientDataJSON.slice(Number(a.challengeIndex), Number(a.challengeIndex) + 11)).toBe('"challenge"');
    expect(a.clientDataJSON.slice(Number(a.typeIndex), Number(a.typeIndex) + 6)).toBe('"type"');
    expect(a.s <= P256_N / 2n).toBe(true);
    const b = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b(pk.x).toString('base64url'), y: b(pk.y).toString('base64url') }, format: 'jwk' });
    const data = Buffer.concat([Buffer.from(a.authenticatorData.slice(2), 'hex'), createHash('sha256').update(a.clientDataJSON).digest()]);
    expect(verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, Buffer.concat([b(a.r), b(a.s)]))).toBe(true);
  });

  it('refuses an assertion over another challenge than the digest', () => {
    expect(() => toWebAuthnAuth(pk.authentication(b64(keccak256(toHex('other')))), digest)).toThrow(/challenge/);
  });

  it('member services take the same assertion keyed by credIdHash', () => {
    const m = toMemberAssertion(pk.authentication(b64(digest)), digest, pk.credIdHash);
    expect(m.credentialId).toBe(pk.credIdHash);
    expect(m.r).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
