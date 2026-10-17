import { describe, it, expect } from 'vitest';
import { dueOrders } from '../src/standing.js';

describe('standing orders due (scheduler, spec 05)', () => {
  const o = (id: number, nextDue: bigint, active = true) => ({ account: '0xa', id, nextDue, active });
  it('picks the active orders whose next due time has come', () => {
    expect(dueOrders([o(1, 100n), o(2, 200n), o(3, 50n, false)], 150n).map((x) => x.id)).toEqual([1]);
  });
  it('an order executed for the period is not due again until the next one (the executor moved nextDue)', () => {
    expect(dueOrders([o(1, 100n + 2_592_000n)], 150n)).toEqual([]);
  });
});
