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
