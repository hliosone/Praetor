import { describe, it, expect } from 'vitest';
import { repeat } from '../src/loop.js';

describe('repeat', () => {
  it('starts the next run only after the previous one ends, however long it takes (overlapping band checks piled up)', async () => {
    let running = 0;
    let most = 0;
    let runs = 0;
    const stop = repeat(async () => {
      running++;
      most = Math.max(most, running);
      runs++;
      await new Promise((r) => setTimeout(r, 30));
      running--;
    }, 5);
    await new Promise((r) => setTimeout(r, 200));
    stop();
    expect(most).toBe(1);
    expect(runs).toBeGreaterThan(2);
  });

  it('keeps going after a run throws', async () => {
    let runs = 0;
    const stop = repeat(async () => { runs++; throw new Error('rpc down'); }, 5);
    await new Promise((r) => setTimeout(r, 60));
    stop();
    expect(runs).toBeGreaterThan(2);
  });
});
