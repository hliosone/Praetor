import { describe, it, expect } from 'vitest';
import { BASESCAN_SEPOLIA, explorerFor, txText } from '../src/index.js';

describe('explorer links (issue #9)', () => {
  it('has no explorer on the local fork, Basescan (or the configured one) otherwise', () => {
    expect(explorerFor('fork')).toBeNull();
    expect(explorerFor('fork', 'https://x')).toBeNull();
    expect(explorerFor('live')).toBe(BASESCAN_SEPOLIA);
    expect(explorerFor('live', 'https://x')).toBe('https://x');
  });

  it('writes the link, or the hash marked local fork', () => {
    expect(txText('https://x', '0xaa')).toBe('https://x/tx/0xaa');
    expect(txText(null, '0xaa')).toBe('tx 0xaa (local fork, no public explorer)');
    expect(txText(null, '0xaa')).not.toContain('basescan');
  });
});
