import { describe, it, expect } from 'vitest';
import { signSession, readSession, SESSION_COOKIE } from '../src/session.js';

const SECRET = 's'.repeat(64);
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const cookie = (v: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(v)}` } });

describe('session cookie (api issues it, mcp OAuth reads it)', () => {
  it('round-trips the account until it expires', () => {
    const v = signSession(ACCOUNT, SECRET, () => 1000);
    expect(readSession(cookie(v), SECRET, () => 1001)).toBe(ACCOUNT);
    expect(readSession(cookie(v), SECRET, () => 1000 + 12 * 3600 + 1)).toBeNull();
  });
  it('refuses a forged mac, another secret, a malformed or missing cookie', () => {
    const v = signSession(ACCOUNT, SECRET, () => 1000);
    expect(readSession(cookie(v.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), SECRET, () => 1001)).toBeNull();
    expect(readSession(cookie(v), 't'.repeat(64), () => 1001)).toBeNull();
    expect(readSession(cookie('nonsense'), SECRET, () => 1001)).toBeNull();
    expect(readSession({ headers: {} }, SECRET, () => 1001)).toBeNull();
  });
});
