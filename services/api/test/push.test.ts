import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import { MemoryPushStore } from '../src/push.js';

const A = '0x00000000000000000000000000000000000c0ffe' as Address;

describe('push subscriptions store', () => {
  it('keeps one subscription per endpoint, per account', async () => {
    const s = new MemoryPushStore();
    const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
    await s.subscribe(A, sub);
    await s.subscribe(A, { ...sub, keys: { p256dh: 'p2', auth: 'a2' } });
    await s.subscribe(A, { ...sub, endpoint: 'https://push.example/2' });
    expect((await s.list(A)).map((x) => [x.endpoint, x.keys.p256dh])).toEqual([['https://push.example/1', 'p2'], ['https://push.example/2', 'p']]);
    expect(await s.list('0x00000000000000000000000000000000000000bb' as Address)).toEqual([]);
  });
});
