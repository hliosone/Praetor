// M7 link: bank-service verifies the agent-signer quote before any KYA (I13 path on the simulator).
import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import { signCaller } from '@praetor/protocol/caller-auth';
import { dotenv } from './lib/stack.js';

const env = dotenv();
const BANK = 'http://10.88.0.21:3020';
const SIGNER = 'http://10.88.0.50:3050';
const ACCOUNT = `0x${keccak256(toHex(`kya-it-${Date.now()}`)).slice(26)}`;

const bank = async (path: string, body: unknown) => {
  const r = await fetch(`${BANK}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.INTERNAL_TOKEN_MEMBERS}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const signer = async (path: string, body?: unknown) => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const method = body === undefined ? 'GET' : 'POST';
  const r = await fetch(`${SIGNER}${path}`, { method, body: raw || undefined, headers: { 'content-type': 'application/json', ...signCaller('api', env.SIGNER_HMAC_API!, method, path, Buffer.from(raw)) } });
  return r.json();
};
describe('bank KYA: quote check, then a KYA built only from the bank\'s own records', () => {
  it('refuses a quote bound to another nonce, and a nonce it did not issue', async () => {
    const { nonce } = (await bank('/kya/nonce', { account: ACCOUNT })).body;
    const other = keccak256(toHex('not-the-bank-nonce'));
    const q = await signer(`/v1/agents/${ACCOUNT}/attest`, { nonce: other, keyVersion: 1 });
    expect((await bank('/kya/verify', { account: ACCOUNT, agentKey: q.address, quote: q.quote, nonce })).body.detail).toMatch(/report data/);
    expect((await bank('/kya/verify', { account: ACCOUNT, agentKey: q.address, quote: q.quote, nonce: other })).body.detail).toMatch(/nonce/);
  });

  it('refuses a quote of another key than the agent key claimed', async () => {
    const { nonce } = (await bank('/kya/nonce', { account: ACCOUNT })).body;
    const q = await signer(`/v1/agents/${ACCOUNT}/attest`, { nonce, keyVersion: 2 });
    const { address: v1 } = await signer(`/v1/agents/${ACCOUNT}/address?v=1`);
    expect((await bank('/kya/verify', { account: ACCOUNT, agentKey: v1, quote: q.quote, nonce })).status).toBe(400);
  });

  it('accepts the right quote, yet builds no KYA without a PersonKYC and a countersigned mandate for this account', async () => {
    const { nonce } = (await bank('/kya/nonce', { account: ACCOUNT })).body;
    const q = await signer(`/v1/agents/${ACCOUNT}/attest`, { nonce, keyVersion: 1 });
    expect((await bank('/kya/verify', { account: ACCOUNT, agentKey: q.address, quote: q.quote, nonce })).status).toBe(200);
    // Caller-supplied KYC fields are ignored: only the bank's records count.
    const r = await bank('/kya', { account: ACCOUNT, agentDidHash: keccak256(toHex('d')), validUntil: '4102444800', kycLevel: 3, jurisdiction: 'HK', kycCredentialHash: keccak256(toHex('k')) });
    expect(r.status).toBe(409);
    expect(r.body.detail).toMatch(/PersonKYC/);
  });
});
