// api database (spec 05): users, passkeys, accounts, approval requests, link tokens. No KYC data.
import { randomUUID } from 'node:crypto';

export type User = { id: string; email: string; account?: string; saltNonce?: string };
export type Passkey = { credentialId: string; userId: string; publicKey: string; counter: number; credIdHash: string; x: string; y: string };

export interface ApiStore {
  createUser(email: string): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  userByAccount(account: string): Promise<User | undefined>;
  /** The first user of this email that has an account (recovery): emails are not verified, so a later sign-up with the
   *  same email must not displace the account it recovers. */
  userByEmail(email: string): Promise<User | undefined>;
  setAccount(userId: string, account: string, saltNonce: bigint): Promise<void>;
  addPasskey(p: Passkey): Promise<void>;
  passkey(credentialId: string): Promise<Passkey | undefined>;
  passkeysOf(userId: string): Promise<Passkey[]>;
  setCounter(credentialId: string, counter: number): Promise<void>;
}

export class MemoryApiStore implements ApiStore {
  users = new Map<string, User>();
  passkeys = new Map<string, Passkey>();
  async createUser(email: string) { const u = { id: randomUUID(), email }; this.users.set(u.id, u); return { ...u }; }
  async getUser(id: string) { const u = this.users.get(id); return u ? { ...u } : undefined; }
  async userByAccount(account: string) { return [...this.users.values()].find((u) => u.account?.toLowerCase() === account.toLowerCase()); }
  async userByEmail(email: string) { return [...this.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase() && u.account); }
  async setAccount(userId: string, account: string, saltNonce: bigint) { const u = this.users.get(userId); if (u) { u.account = account.toLowerCase(); u.saltNonce = saltNonce.toString(); } }
  async addPasskey(p: Passkey) { this.passkeys.set(p.credentialId, { ...p }); }
  async passkey(id: string) { return this.passkeys.get(id); }
  async passkeysOf(userId: string) { return [...this.passkeys.values()].filter((p) => p.userId === userId); }
  async setCounter(id: string, counter: number) { const p = this.passkeys.get(id); if (p) p.counter = counter; }
}
