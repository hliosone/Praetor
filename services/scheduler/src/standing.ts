// Standing orders due now (spec 05 scheduler): the executor itself enforces nextDue (a second run in a period
// reverts NotDue), so the scheduler only picks candidates and holds no key with power (bundler /tx).
export type OrderView = { account: string; id: number; nextDue: bigint; active: boolean };

export function dueOrders(orders: OrderView[], now: bigint): OrderView[] {
  return orders.filter((o) => o.active && o.nextDue <= now);
}
