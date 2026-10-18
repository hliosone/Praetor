import { describe, it, expect } from 'vitest';
import { chainAccountStep } from './accounts.js';

describe('router chain accounts', () => {
  const ext = '0xbc67eb8996a4af3f511bc4110cdaa1575d013ba8';
  it('keeps the account only when it is there and the default', () => {
    expect(chainAccountStep({ keyID: 3, ext, isDefault: true }, ext)).toBe('keep');
    expect(chainAccountStep(undefined, ext)).toBe('add');
  });
  it('makes it the default again after a switch of key set: fork, live, fork left the live account the default', () => {
    expect(chainAccountStep({ keyID: 3, ext, isDefault: false }, ext)).toBe('replace');
    expect(chainAccountStep({ keyID: 3, ext: ext.toUpperCase().replace('0X', '0x'), isDefault: true }, ext)).toBe('replace');
  });
});
