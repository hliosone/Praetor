// The bundler lists its accounts oldest first: the api's console shows the newest (slice(-200)) and the scheduler checks
// them in that order. MySQL returned them in primary-key (address) order, so a new account with a low address vanished
// from the console once a few hundred accounts existed (F9 journey, final regression).
import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import { dotenv } from './lib/stack.js';

const env = dotenv();
const base = process.env.BUNDLER_URL_HOST ?? 'http://10.88.0.10:3010';
const call = async (method: 'GET' | 'POST', body?: unknown) => {
  const r = await fetch(`${base}/accounts`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_BUNDLER}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.status === 204 ? null : ((await r.json()) as { accounts: string[] });
};

describe('bundler accounts', () => {
  it('lists the accounts in registration order, whatever their addresses', async () => {
    const tag = keccak256(toHex(`order-${Date.now()}`)).slice(2, 40);
    const high = `0xff${tag}`;
    const low = `0x00${tag}`;
    expect(await call('POST', { address: high })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(await call('POST', { address: low })).toBeNull();
    const { accounts } = (await call('GET'))!;
    expect(accounts.slice(-2).map((a) => a.toLowerCase())).toEqual([high, low]);
  });
});
