// The committed vectors are exactly what the TS implementation produces today (regenerate on purpose only).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recoverAddress, type Hex } from 'viem';
import { buildVectors, TEST_KEYS } from '../vectors/make-vectors.js';

const fresh = await buildVectors();

describe('golden vectors', () => {
  for (const [name, data] of Object.entries(fresh)) {
    it(`${name}.json is current`, () => {
      const file = JSON.parse(readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), 'utf8'));
      expect(file).toEqual(data);
    });
  }

  it('every signature recovers its declared signer', async () => {
    for (const v of Object.values(fresh) as { digest?: Hex; signatures?: { signer: Hex; sig: Hex }[] }[]) {
      for (const s of v.signatures ?? []) expect(await recoverAddress({ hash: v.digest!, signature: s.sig })).toBe(s.signer);
    }
  });

  it('uses exactly four test keys', () => expect(Object.keys(TEST_KEYS)).toEqual(['bank', 'regulator', 'operator', 'attester']));
});

describe('ownerActionPayloadHash (TS twin of the Solidity function)', () => {
  it('matches every payload vector', async () => {
    const { ownerActionPayloadHash } = await import('../src/index.js');
    const file = JSON.parse(readFileSync(new URL('../vectors/owner-action-payloads.json', import.meta.url), 'utf8')) as { kind: number; args: { account: `0x${string}` }; payload: `0x${string}`; payloadHash: `0x${string}` }[];
    for (const v of file) expect(ownerActionPayloadHash(v.args.account, v.kind, v.payload), String(v.kind)).toBe(v.payloadHash);
  });

  it('hashes a malformed standing order or link payload as plain bytes, like Solidity', async () => {
    const { ownerActionPayloadHash, OwnerActionKind } = await import('../src/index.js');
    const { keccak256 } = await import('viem');
    expect(ownerActionPayloadHash('0x0000000000000000000000000000000000000001', OwnerActionKind.ADD_STANDING_ORDER, '0x01')).toBe(keccak256('0x01'));
    expect(ownerActionPayloadHash('0x0000000000000000000000000000000000000001', OwnerActionKind.PAUSE_AGENT, '0x')).toBe(`0x${'00'.repeat(32)}`);
  });
});
