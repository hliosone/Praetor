// M7 link: api/bank/mcp to agent-signer (caller HMAC), agent-signer to the dstack simulator (keys, quotes).
import { describe, it, expect } from 'vitest';
import { concat, keccak256, toHex, hashMessage, recoverAddress, type Hex } from 'viem';
import { signCaller } from '@praetor/protocol/caller-auth';
import { encodeExecute, toJson, userOpHash, ENTRY_POINT, type UserOp } from '@praetor/userop';
import { compose, dotenv } from './lib/stack.js';

const env = dotenv();
const URL_ = process.env.AGENT_SIGNER_URL_HOST ?? 'http://10.88.0.50:3050';
const secret = { api: env.SIGNER_HMAC_API!, mcp: env.SIGNER_HMAC_MCP!, bank: env.SIGNER_HMAC_BANK! };
const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';

async function call(caller: 'api' | 'mcp' | 'bank', method: 'GET' | 'POST', path: string, body?: unknown) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const r = await fetch(`${URL_}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller(caller, secret[caller], method, path, Buffer.from(raw)) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${URL_}/health`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('agent-signer not back');
}

describe('agent-signer on the dstack simulator', () => {
  it('reports simulator mode from its own config', async () => {
    expect((await call('api', 'GET', '/v1/info')).body).toMatchObject({ simulator: true });
  });

  it('derives the same agent address after a restart of the signer and the simulator', async () => {
    const a = (await call('api', 'GET', `/v1/agents/${ACCOUNT}/address?v=1`)).body.address;
    expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    compose('restart', 'dstack-sim', 'agent-signer');
    await waitHealthy();
    expect((await call('bank', 'GET', `/v1/agents/${ACCOUNT}/address?v=1`)).body.address).toBe(a);
    expect((await call('api', 'GET', `/v1/agents/${ACCOUNT}/address?v=2`)).body.address).not.toBe(a);
  }, 120_000);

  it('quotes bind keccak256(agent address || nonce)', async () => {
    const nonce = keccak256(toHex(`it-${Date.now()}`));
    const r = await call('api', 'POST', `/v1/agents/${ACCOUNT}/attest`, { nonce, keyVersion: 1 });
    expect(r.status).toBe(200);
    expect(String(r.body.quote).toLowerCase()).toContain(keccak256(concat([r.body.address as Hex, nonce])).slice(2));
  });

  it('signs an execute userOp for mcp only, and refuses a non-execute one', async () => {
    const op = { sender: ACCOUNT, nonce: 1n, callData: encodeExecute([{ to: '0x0000000000000000000000000000000000000bee', value: 0n, data: '0x' }]), callGasLimit: 300000n, verificationGasLimit: 300000n, preVerificationGas: 60000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, signature: '0x' } as UserOp;
    const body = { userOp: toJson(op), chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: 1 };
    expect((await call('api', 'POST', `/v1/agents/${ACCOUNT}/sign-userop`, body)).status).toBe(403);
    const ok = await call('mcp', 'POST', `/v1/agents/${ACCOUNT}/sign-userop`, body);
    const agent = (await call('api', 'GET', `/v1/agents/${ACCOUNT}/address?v=1`)).body.address;
    expect(await recoverAddress({ hash: hashMessage({ raw: userOpHash(op) }), signature: ok.body.signature })).toBe(agent);
    expect((await call('mcp', 'POST', `/v1/agents/${ACCOUNT}/sign-userop`, { ...body, userOp: toJson({ ...op, callData: '0xdeadbeef' }) })).status).toBe(400);
  });

  it('refuses unsigned calls', async () => {
    expect((await fetch(`${URL_}/v1/info`)).status).toBe(401);
  });
});
