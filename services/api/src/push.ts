// Web push subscriptions (spec 05 api data, spec 07 PWA): the browser's subscription per account, read by the notifier
// (internal route) to send approvals, refusals and freezes to the owner's devices.
import type { Address } from 'viem';
import type { SqlRunner } from '@praetor/db';

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

export interface PushStore {
  subscribe(account: Address, s: PushSubscriptionJson): Promise<void>;
  list(account: Address): Promise<PushSubscriptionJson[]>;
}

export class MemoryPushStore implements PushStore {
  private subs = new Map<string, Map<string, PushSubscriptionJson>>();
  async subscribe(account: Address, s: PushSubscriptionJson) {
    const key = account.toLowerCase();
    const m = this.subs.get(key) ?? new Map<string, PushSubscriptionJson>();
    m.set(s.endpoint, s);
    this.subs.set(key, m);
  }
  async list(account: Address) { return [...(this.subs.get(account.toLowerCase())?.values() ?? [])]; }
}

export class MySqlPushStore implements PushStore {
  constructor(private readonly r: SqlRunner) {}
  async subscribe(account: Address, s: PushSubscriptionJson) {
    await this.r.query('REPLACE INTO push_subscriptions (endpoint, account, p256dh, auth) VALUES (?, ?, ?, ?)', [s.endpoint, account.toLowerCase(), s.keys.p256dh, s.keys.auth]);
  }
  async list(account: Address) {
    const rows = (await this.r.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account = ?', [account.toLowerCase()])) as { endpoint: string; p256dh: string; auth: string }[];
    return rows.map((x) => ({ endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }));
  }
}
