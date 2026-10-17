import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { mysqlTable, varchar, text, datetime, boolean as bool } from 'drizzle-orm/mysql-core';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { verifyAssertion, AssertionError, type Assertion, type PublicKey } from './webauthn.js';

export class StaffError extends Error {}

export type StaffRecord = { credentialId: Hex; x: bigint; y: bigint; label: string };

export interface StaffStore {
  count(): Promise<number>;
  get(credentialId: Hex): Promise<StaffRecord | null>;
  add(r: StaffRecord): Promise<void>;
  tokenUsed(): Promise<boolean>;
  markTokenUsed(): Promise<void>;
}

export class MemoryStaffStore implements StaffStore {
  private staff = new Map<string, StaffRecord>();
  private used = false;
  async count() { return this.staff.size; }
  async get(id: Hex) { return this.staff.get(id.toLowerCase()) ?? null; }
  async add(r: StaffRecord) { this.staff.set(r.credentialId.toLowerCase(), r); }
  async tokenUsed() { return this.used; }
  async markTokenUsed() { this.used = true; }
}

export const staffPasskeys = mysqlTable('staff_passkeys', {
  credentialId: varchar('credential_id', { length: 66 }).primaryKey(),
  x: varchar('x', { length: 80 }).notNull(),
  y: varchar('y', { length: 80 }).notNull(),
  label: text('label').notNull(),
  createdAt: datetime('created_at', { fsp: 3 }),
});
export const staffSettings = mysqlTable('staff_settings', {
  name: varchar('name', { length: 64 }).primaryKey(),
  flag: bool('flag').notNull(),
});

type Db = { select: Function; insert: Function } & Record<string, unknown>;

export class MySqlStaffStore implements StaffStore {
  constructor(private db: Db) {}
  async count() { return ((await (this.db as any).select().from(staffPasskeys)) as unknown[]).length; }
  async get(id: Hex) {
    const rows = (await (this.db as any).select().from(staffPasskeys).where(eq(staffPasskeys.credentialId, id.toLowerCase()))) as { credentialId: string; x: string; y: string; label: string }[];
    const r = rows[0];
    return r ? { credentialId: r.credentialId as Hex, x: BigInt(r.x), y: BigInt(r.y), label: r.label } : null;
  }
  async add(r: StaffRecord) {
    await (this.db as any).insert(staffPasskeys).values({ credentialId: r.credentialId.toLowerCase(), x: r.x.toString(), y: r.y.toString(), label: r.label });
  }
  async tokenUsed() {
    const rows = (await (this.db as any).select().from(staffSettings).where(eq(staffSettings.name, 'enrol_token_used'))) as { flag: boolean }[];
    return rows[0]?.flag ?? false;
  }
  async markTokenUsed() {
    await (this.db as any).insert(staffSettings).values({ name: 'enrol_token_used', flag: true }).onDuplicateKeyUpdate({ set: { flag: true } });
  }
}

/** Staff passkeys of one member service: first one enrolled with the one-time token (Q28), the next ones added by an
 *  enrolled staff member; every consortium signature needs a staff assertion over the digest. */
export class StaffAuth {
  constructor(private store: StaffStore, private cfg: { enrolToken: string; rpId: string; origin: string }) {}

  static addChallenge(credentialId: Hex, key: PublicKey): Hex {
    return keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], ['praetor:add-staff', credentialId, key.x, key.y]));
  }

  async enrol(token: string, credentialId: Hex, key: PublicKey, label: string): Promise<void> {
    if ((await this.store.tokenUsed()) || (await this.store.count()) > 0) throw new StaffError('enrolment token already used');
    const a = Buffer.from(token);
    const b = Buffer.from(this.cfg.enrolToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new StaffError('wrong enrolment token');
    await this.store.add({ credentialId, x: key.x, y: key.y, label });
    await this.store.markTokenUsed();
  }

  async add(by: Assertion, credentialId: Hex, key: PublicKey, label: string): Promise<void> {
    await this.verify(StaffAuth.addChallenge(credentialId, key), by);
    await this.store.add({ credentialId, x: key.x, y: key.y, label });
  }

  async verify(challenge: Hex, a: Assertion): Promise<StaffRecord> {
    const rec = await this.store.get(a.credentialId);
    if (!rec) throw new StaffError('unknown staff credential');
    try {
      verifyAssertion({ x: rec.x, y: rec.y }, a, { challenge, rpId: this.cfg.rpId, origin: this.cfg.origin });
    } catch (e) {
      throw new StaffError(e instanceof AssertionError ? e.message : 'invalid assertion');
    }
    return rec;
  }
}
