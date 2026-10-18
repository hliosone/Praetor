// Red team D62: onboardings at the same time failed in the bank, whose FISCO and Base desk transactions read the same
// nonce (FISCO's pool refused the second, or it reverted).
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapConsortium, createAccount, onboard, stack, type Stack } from '../../scripts/demo/lib.js';

let s: Stack;
beforeAll(async () => {
  s = stack();
  await bootstrapConsortium(s);
}, 600_000);

describe('bank under parallel onboardings', () => {
  it('three accounts onboarded at once all get their KYA, identity and agent key', async () => {
    const tag = Date.now().toString(36);
    const accounts = await Promise.all([0, 1, 2].map((i) => createAccount(s, `parallel-${tag}-${i}`)));
    const r = await Promise.allSettled(accounts.map((a, i) => onboard(s, a, undefined, { label: `parallel-${tag}-${i}` })));
    expect(r.map((x) => (x.status === 'rejected' ? String(x.reason).slice(0, 300) : 'ok'))).toEqual(['ok', 'ok', 'ok']);
  }, 900_000);
});
