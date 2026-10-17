import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { Address, Hex } from 'viem';
import { toJson, type UserOp } from '@praetor/userop';
import { createApp } from '../src/app.js';
import { NotSponsorable, RateLimited, ValidationFailed, NotAllowed } from '../src/bundler.js';

const TOKEN = 'internal-token-for-tests';
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const op: UserOp = {
  sender: A(1), nonce: 1n, callData: '0xe9ae5c53', callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n,
  maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, signature: '0x01',
};

function app(overrides: Partial<Record<string, (...a: unknown[]) => Promise<unknown>>> = {}) {
  const bundler = {
    register: async () => undefined,
    prepare: async () => ({ userOp: op, userOpHash: `0x${'11'.repeat(32)}` as Hex }),
    send: async () => ({ userOpHash: `0x${'11'.repeat(32)}`, txHash: `0x${'22'.repeat(32)}`, success: true, reasons: [0], refusalLogTx: null, skipped: false, gasUsed: 5n }),
    tx: async () => ({ txHash: `0x${'33'.repeat(32)}`, success: true }),
    getOp: async () => null,
    ...overrides,
  };
  return createApp({ bundler: bundler as never, token: TOKEN, health: async () => ({ rpc: true, db: true }), version: 'test' });
}
const auth = { authorization: `Bearer ${TOKEN}` };

describe('bundler HTTP API', () => {
  it('serves /health and /version without auth', async () => {
    expect((await request(app()).get('/health')).body).toEqual({ ok: true, rpc: true, db: true });
    expect((await request(app()).get('/version')).body.version).toBe('test');
  });

  it('requires the internal bearer token everywhere else', async () => {
    expect((await request(app()).post('/accounts').send({ address: A(1) })).status).toBe(401);
    expect((await request(app()).post('/accounts').set({ authorization: 'Bearer nope' }).send({ address: A(1) })).status).toBe(401);
    expect((await request(app()).post('/accounts').set(auth).send({ address: A(1) })).status).toBe(204);
  });

  it('validates every body with zod', async () => {
    expect((await request(app()).post('/accounts').set(auth).send({ address: 'nope' })).status).toBe(400);
    expect((await request(app()).post('/userop/prepare').set(auth).send({ sender: A(1), callData: '0x', validator: 'root' })).status).toBe(400);
    expect((await request(app()).post('/tx').set(auth).send({ to: A(1) })).status).toBe(400);
  });

  it('prepares and sends userOps as JSON with hex numbers', async () => {
    const p = await request(app()).post('/userop/prepare').set(auth).send({ sender: A(1), callData: '0xe9ae5c53', validator: 'agent' });
    expect(p.status).toBe(200);
    expect(p.body.userOp.nonce).toBe('0x1');
    const s = await request(app()).post('/userop/send').set(auth).send({ userOp: toJson(op) });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ success: true, reasons: [0], gasUsed: '5' });
  });

  it('maps refusals of the bundler to HTTP errors', async () => {
    const cases: [Error, number][] = [[new NotSponsorable('x'), 403], [new RateLimited('x'), 429], [new ValidationFailed('AA24 signature error'), 422], [new NotAllowed('x'), 403]];
    for (const [err, status] of cases) {
      const r = await request(app({ send: async () => { throw err; } })).post('/userop/send').set(auth).send({ userOp: toJson(op) });
      expect(r.status).toBe(status);
      expect(r.body.error).toBe(err.constructor.name);
    }
    const v = await request(app({ send: async () => { throw new ValidationFailed('AA24 signature error'); } })).post('/userop/send').set(auth).send({ userOp: toJson(op) });
    expect(v.body.detail).toBe('AA24 signature error');
  });

  it('returns 404 for an unknown userOp', async () => {
    expect((await request(app()).get(`/userop/0x${'44'.repeat(32)}`).set(auth)).status).toBe(404);
  });
});
