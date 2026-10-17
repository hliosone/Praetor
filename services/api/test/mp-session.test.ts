import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { readSession, signSession, SESSION_COOKIE } from '@praetor/protocol/session';
import { MemoryMpBindingStore, MpSessions, MP_SESSION_TTL_S } from '../src/mp-session.js';
import { WechatError } from '../src/wechat.js';
import { MySqlMpBindingStore } from '../src/mysql.js';

const SECRET = 's'.repeat(64);
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe' as Address;
const BINDING = `0x${'33'.repeat(32)}` as Hex;
const ZERO = `0x${'00'.repeat(32)}` as Hex;
const oh = (openid: string) => keccak256(toHex(openid));

// Real codes are single use: so is this fake.
function singleUseWechat() {
  const used = new Set<string>();
  return async (code: string) => {
    if (used.has(code)) throw new WechatError('code been used');
    used.add(code);
    return `openid-of-${code.split(':')[0]}`;
  };
}

function setup(o: { onchain?: Hex; now?: () => number; resolve?: ((code: string) => Promise<string>) | null } = {}) {
  const bindings = new MemoryMpBindingStore();
  let onchain = o.onchain ?? BINDING;
  const s = new MpSessions({
    secret: SECRET, appId: 'wx-test-app', code2session: o.resolve === undefined ? singleUseWechat() : o.resolve, bindings,
    bindingOf: async () => onchain, now: o.now,
  });
  return { s, bindings, setOnchain: (h: Hex) => { onchain = h; } };
}

describe('MySqlMpBindingStore', () => {
  it('replaces the account or the user in one statement, lower case, and reads back', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const runner = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return sql.startsWith('SELECT') ? [{ account: ACCOUNT, binding_hash: BINDING }] : []; } };
    const store = new MySqlMpBindingStore(runner);
    await store.put(oh('x').toUpperCase().replace('0X', '0x') as Hex, { account: '0x00000000000000000000000000000000000C0FFE', bindingHash: BINDING });
    expect(calls[0]).toEqual({ sql: 'REPLACE INTO mp_bindings (openid_hash, account, binding_hash) VALUES (?, ?, ?)', params: [oh('x'), ACCOUNT, BINDING] });
    expect(await store.get(oh('x'))).toEqual({ account: ACCOUNT, bindingHash: BINDING });
    expect(calls[1]).toEqual({ sql: 'SELECT account, binding_hash FROM mp_bindings WHERE openid_hash = ?', params: [oh('x')] });
    await store.removeAccount(ACCOUNT);
    expect(calls[2]).toEqual({ sql: 'DELETE FROM mp_bindings WHERE account = ?', params: [ACCOUNT] });
  });
});

describe('mini program sessions (spec 05)', () => {
  it('a WeChat user with no link gets a guest session (no account)', async () => {
    const { s } = setup();
    const r = await s.login('lin');
    expect(r.account).toBeNull();
    expect(await s.current(r.token)).toEqual({ openidHash: oh('openid-of-lin'), account: null, bindingHash: null });
  });

  it('the linked WeChat user gets the account, while its binding is still the one on Base', async () => {
    const { s } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    const r = await s.login('lin');
    expect(r.account).toBe(ACCOUNT);
    expect(await s.current(r.token)).toEqual({ openidHash: oh('openid-of-lin'), account: ACCOUNT, bindingHash: BINDING });
  });

  it('a binding Base no longer holds (unlink, recovery, another phone) gives a guest session and drops the link', async () => {
    const { s, bindings, setOnchain } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    setOnchain(ZERO);
    expect((await s.login('lin')).account).toBeNull();
    expect(await bindings.get(oh('openid-of-lin'))).toBeUndefined();
  });

  it('one WeChat user per account: a new link replaces the previous one, whose session stops working', async () => {
    const { s } = setup();
    await s.linked(oh('openid-of-old'), ACCOUNT, BINDING);
    const old = await s.login('old');
    await s.linked(oh('openid-of-new'), ACCOUNT, BINDING);
    expect(await s.current(old.token)).toBeNull();
    expect((await s.login('new')).account).toBe(ACCOUNT);
  });

  it('a binding Base drops without the api (recovery executed, an unlink sent elsewhere) ends an open session at its next request', async () => {
    const { s, setOnchain } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    const r = await s.login('lin');
    setOnchain(ZERO);
    expect(await s.current(r.token)).toBeNull();
  });

  it('a request while Base disagrees keeps the link record: a lagging RPC read right after the link must not unlink the user', async () => {
    const { s, setOnchain } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    const r = await s.login('lin');
    setOnchain(ZERO);
    expect(await s.current(r.token)).toBeNull();
    setOnchain(BINDING);
    expect((await s.current(r.token))?.account).toBe(ACCOUNT);
  });

  it('unlinked(account) ends its sessions at once', async () => {
    const { s } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    const r = await s.login('lin');
    await s.unlinked(ACCOUNT);
    expect(await s.current(r.token)).toBeNull();
  });

  it('a code WeChat refuses (reused, invalid) is a 401, and sign-in without WeChat configured a 503', async () => {
    const { s } = setup();
    await s.login('once');
    await expect(s.login('once')).rejects.toMatchObject({ status: 401 });
    await expect(setup({ resolve: null }).s.login('x')).rejects.toMatchObject({ status: 503 });
  });

  it('tokens expire, and a token changed in any way is refused', async () => {
    let t = 1_800_000_000;
    const { s } = setup({ now: () => t });
    const r = await s.login('lin');
    expect(r.expiresAt).toBe(1_800_000_000 + MP_SESSION_TTL_S);
    expect(MP_SESSION_TTL_S).toBeLessThanOrEqual(2 * 3600);
    const parts = r.token.split('.');
    const forged = [parts[0], ACCOUNT.toLowerCase(), ...parts.slice(2)].join('.');
    expect(await s.current(forged)).toBeNull();
    expect(await s.current(`${r.token}x`)).toBeNull();
    t += MP_SESSION_TTL_S;
    expect(await s.current(r.token)).toBeNull();
  });

  it('is not the web session: neither token is accepted in place of the other', async () => {
    const { s } = setup();
    await s.linked(oh('openid-of-lin'), ACCOUNT, BINDING);
    const mp = await s.login('lin');
    expect(readSession({ headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mp.token)}` } }, SECRET)).toBeNull();
    expect(await s.current(signSession(ACCOUNT, SECRET))).toBeNull();
  });

  it('expectedBinding: the binding a SOTER result would give this WeChat user (the bindingHash vector)', () => {
    const v = JSON.parse(readFileSync(new URL('../../../packages/protocol/vectors/identifiers.json', import.meta.url), 'utf8')).binding;
    const { s } = setup();
    const resultJSON = JSON.stringify({ raw: 'ab'.repeat(32), counter: 3, uid: v.uid, cpu_id: v.cpuId });
    expect(s.expectedBinding(oh(v.openid), resultJSON)).toBe(v.bindingHash);
    expect(s.expectedBinding(oh(v.openid), '{"raw":"x"}')).toBeNull();
    expect(s.expectedBinding(oh(v.openid), 'not json')).toBeNull();
  });
});
