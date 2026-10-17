import { describe, it, expect } from 'vitest';
import { signCaller, verifyCaller, ReplayGuard } from '../src/callerAuth.js';

const secrets = { mcp: 'm'.repeat(64), api: 'a'.repeat(64) };
const body = Buffer.from('{"nonce":"0x01"}');

describe('caller HMAC (service to service)', () => {
  it('verifies the caller, method, path, time and exact body', () => {
    const h = signCaller('mcp', secrets.mcp, 'POST', '/v1/agents/0xabc/sign-userop', body, 1_800_000_000);
    expect(verifyCaller(h, secrets, 'POST', '/v1/agents/0xabc/sign-userop', body, 1_800_000_010)).toBe('mcp');
  });

  it('refuses another body, path, method, secret, an unknown caller, or a stale timestamp', () => {
    const h = signCaller('mcp', secrets.mcp, 'POST', '/p', body, 1_800_000_000);
    expect(verifyCaller(h, secrets, 'POST', '/p', Buffer.from('{}'), 1_800_000_000)).toBeNull();
    expect(verifyCaller(h, secrets, 'POST', '/q', body, 1_800_000_000)).toBeNull();
    expect(verifyCaller(h, secrets, 'GET', '/p', body, 1_800_000_000)).toBeNull();
    expect(verifyCaller({ ...h, 'x-praetor-caller': 'api' }, secrets, 'POST', '/p', body, 1_800_000_000)).toBeNull();
    expect(verifyCaller({ ...h, 'x-praetor-caller': 'bank' }, secrets, 'POST', '/p', body, 1_800_000_000)).toBeNull();
    expect(verifyCaller(h, secrets, 'POST', '/p', body, 1_800_000_061)).toBeNull();
    expect(verifyCaller(h, secrets, 'POST', '/p', body, 1_799_999_939)).toBeNull();
    expect(verifyCaller({}, secrets, 'POST', '/p', body, 1_800_000_000)).toBeNull();
  });

  it('the replay guard accepts a signature once', () => {
    const g = new ReplayGuard();
    const h = signCaller('api', secrets.api, 'POST', '/p', body, 1_800_000_000);
    expect(g.once(h['x-praetor-signature'], 1_800_000_000)).toBe(true);
    expect(g.once(h['x-praetor-signature'], 1_800_000_001)).toBe(false);
  });
});

describe('identical requests in the same second', () => {
  it('get distinct signatures (a nonce is signed), so the replay guard does not refuse the second', () => {
    const a = signCaller('api', secrets.api, 'GET', '/v1/info', Buffer.alloc(0), 1_800_000_000);
    const b = signCaller('api', secrets.api, 'GET', '/v1/info', Buffer.alloc(0), 1_800_000_000);
    expect(a['x-praetor-signature']).not.toBe(b['x-praetor-signature']);
    expect(verifyCaller(b, secrets, 'GET', '/v1/info', Buffer.alloc(0), 1_800_000_000)).toBe('api');
    expect(verifyCaller({ ...b, 'x-praetor-nonce': a['x-praetor-nonce'] }, secrets, 'GET', '/v1/info', Buffer.alloc(0), 1_800_000_000)).toBeNull();
  });
});
