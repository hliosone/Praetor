import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, keccak256, toHex, type Hex } from 'viem';
import { canonicalJson, auditEntryHash, nextHead, buildAuditChain, ZERO_HASH, type AuditEntryInput } from '../src/index.js';

describe('canonical JSON (RFC 8785 subset)', () => {
  it('sorts keys by UTF-16 code units and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: 'x', c: { z: true, y: null } })).toBe('{"a":"x","b":1,"c":{"y":null,"z":true}}');
    expect(canonicalJson({ '\u20ac': 1, '\r': 2, '1': 3, a: 4 })).toBe('{"\\r":2,"1":3,"a":4,"\u20ac":1}');
  });
  it('serialises numbers like ECMAScript and strings with minimal escapes', () => {
    expect(canonicalJson([1e-7, 0.1, -0, 100, 1.5e-21])).toBe('[1e-7,0.1,0,100,1.5e-21]');
    expect(canonicalJson('a"b\\c\u0001')).toBe('"a\\"b\\\\c\\u0001"');
  });
  it('refuses unsafe integers, bigints and undefined (amounts are decimal strings, Q12)', () => {
    expect(() => canonicalJson(2 ** 53)).toThrow();
    expect(() => canonicalJson(1n as unknown as number)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});

describe('audit chain', () => {
  const entry = (seq: number): AuditEntryInput => ({
    seq, account: '0x1111111111111111111111111111111111111111', kind: 'DECISION', reason: 'OK', tier: 'T1_AUTONOMOUS',
    amountUsd6: '150000000', atMs: 1_800_000_000_000 + seq,
  });

  it('entryHash = keccak256(canonical JSON without entryHash); head_n = keccak256(abi.encode(head_{n-1}, entryHash_n))', () => {
    const e = { ...entry(0), prevHead: ZERO_HASH };
    expect(auditEntryHash(e)).toBe(keccak256(toHex(canonicalJson(e))));
    const h = auditEntryHash(e);
    expect(nextHead(ZERO_HASH, h)).toBe(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [ZERO_HASH, h])));
  });

  it('chains five entries, each prevHead = previous head, starting from 0x0', () => {
    const chain = buildAuditChain([0, 1, 2, 3, 4].map(entry));
    expect(chain).toHaveLength(5);
    let head: Hex = ZERO_HASH;
    for (const e of chain) {
      expect(e.prevHead).toBe(head);
      head = nextHead(head, e.entryHash);
      expect(e.head).toBe(head);
    }
  });

  it('lowercases addresses and hashes before hashing', () => {
    const a = auditEntryHash({ ...entry(0), account: '0xABCDEF0000000000000000000000000000000000', prevHead: ZERO_HASH });
    const b = auditEntryHash({ ...entry(0), account: '0xabcdef0000000000000000000000000000000000', prevHead: ZERO_HASH });
    expect(a).toBe(b);
  });
});
