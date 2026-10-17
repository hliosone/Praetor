import { and, eq, sql } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import type { connect } from '@praetor/db';
import { accounts, userops, refusals } from '@praetor/db/bundler';

export type OpRecord = { userOpHash: Hex; sender: Address; validator: string; txHash: Hex | null; success: boolean | null; reasons: number[]; refusalLogTx: Hex | null };

export interface Store {
  isRegistered(address: Address): Promise<boolean>;
  register(address: Address): Promise<void>;
  refusalCount(account: Address, day: number): Promise<number>;
  bumpRefusal(account: Address, day: number): Promise<void>;
  recordOp(r: OpRecord): Promise<void>;
  getOp(userOpHash: Hex): Promise<OpRecord | null>;
}

const key = (a: string) => a.toLowerCase();

export class MemoryStore implements Store {
  private regs = new Set<string>();
  private counts = new Map<string, number>();
  private ops = new Map<string, OpRecord>();
  async isRegistered(a: Address) { return this.regs.has(key(a)); }
  async register(a: Address) { this.regs.add(key(a)); }
  async refusalCount(a: Address, day: number) { return this.counts.get(`${key(a)}:${day}`) ?? 0; }
  async bumpRefusal(a: Address, day: number) { this.counts.set(`${key(a)}:${day}`, (await this.refusalCount(a, day)) + 1); }
  async recordOp(r: OpRecord) { this.ops.set(key(r.userOpHash), r); }
  async getOp(h: Hex) { return this.ops.get(key(h)) ?? null; }
}

export class MySqlStore implements Store {
  constructor(private db: ReturnType<typeof connect>['db']) {}

  async isRegistered(a: Address) {
    return (await this.db.select().from(accounts).where(eq(accounts.address, key(a)))).length > 0;
  }

  async register(a: Address) {
    await this.db.insert(accounts).values({ address: key(a) }).onDuplicateKeyUpdate({ set: { address: key(a) } });
  }

  async refusalCount(a: Address, day: number) {
    const rows = await this.db.select().from(refusals).where(and(eq(refusals.account, key(a)), eq(refusals.day, day)));
    return rows[0]?.count ?? 0;
  }

  async bumpRefusal(a: Address, day: number) {
    await this.db.insert(refusals).values({ account: key(a), day, count: 1 }).onDuplicateKeyUpdate({ set: { count: sql`count + 1` } });
  }

  async recordOp(r: OpRecord) {
    const row = { ...r, userOpHash: key(r.userOpHash), sender: key(r.sender) };
    await this.db.insert(userops).values(row).onDuplicateKeyUpdate({ set: { txHash: r.txHash, success: r.success, reasons: r.reasons, refusalLogTx: r.refusalLogTx } });
  }

  async getOp(h: Hex): Promise<OpRecord | null> {
    const rows = await this.db.select().from(userops).where(eq(userops.userOpHash, key(h)));
    const r = rows[0];
    if (!r) return null;
    return { userOpHash: r.userOpHash as Hex, sender: r.sender as Address, validator: r.validator, txHash: r.txHash as Hex | null, success: r.success, reasons: r.reasons, refusalLogTx: r.refusalLogTx as Hex | null };
  }
}
