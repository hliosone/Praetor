import { describe, it, expect } from 'vitest';
import { T2_REASONS } from '../src/constants.js';
import { reasonWords } from '../src/words.js';

describe('the owner\'s words for an approval request\'s reasons (web approval page, notification)', () => {
  it('turns a comma-separated reason list into plain words, in order', () => {
    expect(reasonWords('UNKNOWN_PAYEE,OVER_AUTO_CAP')).toEqual(['the payee is not in your mandate', 'above the amount the agent may pay alone']);
    expect(reasonWords('REBALANCE_LIMIT')).toEqual(['over the rebalancing limit (per day or per trade)']);
  });

  it('has words for every reason a human approval lifts, and keeps an unknown name as it is', () => {
    for (const r of T2_REASONS) expect(reasonWords(r)[0]).not.toBe(r);
    expect(reasonWords('SOMETHING_NEW')).toEqual(['SOMETHING_NEW']);
    expect(reasonWords('')).toEqual([]);
  });
});
