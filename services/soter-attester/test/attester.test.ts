import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { concat, keccak256, toHex, bytesToHex, recoverAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signCaller } from '@praetor/protocol/caller-auth';
import { bindingHash, digest, praetorDomain } from '@praetor/protocol';
import { createAttesterApp } from '../src/app.js';
import { createFakeTencent, fakeSoterSignature } from '../src/fake-tencent.js';
import type { KeySource } from '../src/app.js';

const SECRET = 'a'.repeat(64);
const HOOK = '0x00000000000000000000000000000000000000aa';
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
const NOW = 1_800_000_000;
const KEY = keccak256(toHex('praetor/soter-attester/v1'));
const keys: KeySource = { getKey: async () => KEY, quote: async (rd) => ({ quote: `feed${bytesToHex(rd).slice(2)}` }), info: async () => ({ appId: 'app', composeHash: 'compose' }) };
const DIGEST = keccak256(toHex('tier2 approval digest'));
const resultJSON = (raw = DIGEST.slice(2), counter = 7) => JSON.stringify({ raw, counter, uid: 'uid-1', cpu_id: 'cpu-1' });

let tencentBase = '';
let app: ReturnType<typeof createAttesterApp>;
beforeEach(async () => {
  const fake = createFakeTencent({ appId: 'wx-test', secret: 'mp-secret' });
  const server = await new Promise<import('node:http').Server>((r) => { const s = fake.listen(0, () => r(s)); });
  tencentBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  app = createAttesterApp({
    keys, secrets: { api: SECRET }, simulator: true, version: 't', now: () => NOW,
    tencent: { base: tencentBase, appId: 'wx-test', secret: 'mp-secret' },
    domain: { name: 'Praetor-test', hook: HOOK },
  });
});

const call = (path: string, body?: unknown) => {
  const raw = Buffer.from(body === undefined ? '' : JSON.stringify(body));
  const method = body === undefined ? 'GET' : 'POST';
  const r = method === 'GET' ? request(app).get(path) : request(app).post(path).set('content-type', 'application/json').send(raw.toString());
  return r.set(signCaller('api', SECRET, method, path, raw, NOW));
};
const approve = (o: Record<string, unknown> = {}) => {
  const json = (o.resultJSON as string) ?? resultJSON();
  return {
    code: 'code-lin', account: ACCOUNT, digestHex: DIGEST.slice(2), expiresAt: NOW + 600, authMode: 'facial',
    resultJSON: json, resultJSONSignature: fakeSoterSignature('openid-of-code-lin', json), ...o,
  };
};

describe('soter-attester', () => {
  it('info names the attester address and simulator mode', async () => {
    const r = await call('/v1/info').expect(200);
    expect(r.body).toEqual({ attester: privateKeyToAccount(KEY).address, appId: 'app', composeHash: 'compose', simulator: true, version: 't' });
  });

  it('attest binds keccak256(attester || nonce)', async () => {
    const nonce = keccak256(toHex('n'));
    const r = await call('/v1/attest', { nonce }).expect(200);
    expect(r.body.quote).toBe(`feed${keccak256(concat([privateKeyToAccount(KEY).address, nonce])).slice(2)}`);
  });

  it('approve: Tencent-verified result over the digest gives a SoterApproval signed by the attester', async () => {
    const r = await call('/v1/soter/approve', approve()).expect(200);
    const a = r.body.soterApproval;
    expect(a).toEqual({
      account: ACCOUNT, digest: DIGEST, soterCounter: '7', expiresAt: String(NOW + 600),
      bindingHash: bindingHash({ mpAppId: 'wx-test', openid: 'openid-of-code-lin', uid: 'uid-1', cpuId: 'cpu-1' }),
    });
    const d = digest(praetorDomain('Praetor-test', HOOK), 'SoterApproval', { ...a, soterCounter: 7n, expiresAt: BigInt(NOW + 600) });
    expect(await recoverAddress({ hash: d, signature: r.body.attesterSig as Hex })).toBe(privateKeyToAccount(KEY).address);
    expect(JSON.stringify(r.body)).not.toMatch(/openid-of-code-lin|uid-1|cpu-1/);
  });

  it('refuses a result Tencent does not verify, a raw that is not the digest, a bad code, a far expiry', async () => {
    await call('/v1/soter/approve', approve({ resultJSONSignature: fakeSoterSignature('someone-else', resultJSON()) })).expect(403);
    const other = resultJSON(keccak256(toHex('other')).slice(2));
    await call('/v1/soter/approve', approve({ resultJSON: other, resultJSONSignature: fakeSoterSignature('openid-of-code-lin', other) })).expect(403);
    await call('/v1/soter/approve', approve({ code: 'bad' })).expect(403);
    await call('/v1/soter/approve', approve({ expiresAt: NOW + 3601 })).expect(400);
    await call('/v1/soter/approve', approve({ expiresAt: NOW - 1 })).expect(400);
  });

  it('refuses an uppercase or 0x-prefixed digest (WeChat shows exactly 64 lowercase hex)', async () => {
    await call('/v1/soter/approve', approve({ digestHex: DIGEST.slice(2).toUpperCase() })).expect(400);
    await call('/v1/soter/approve', approve({ digestHex: DIGEST })).expect(400);
  });

  it('only the api may call it', async () => {
    const raw = Buffer.from(JSON.stringify(approve()));
    await request(app).post('/v1/soter/approve').set('content-type', 'application/json').send(raw.toString()).set(signCaller('mcp', SECRET, 'POST', '/v1/soter/approve', raw, NOW)).expect(401);
  });
});
