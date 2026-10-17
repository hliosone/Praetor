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
const kya = (agentKey: string, extra: object) => ({
  account: ACCOUNT, agentKey, agentDidHash: keccak256(toHex('d')), kycCredentialHash: keccak256(toHex('k')), mandateCredentialHash: keccak256(toHex('m')),
  kycLevel: 2, riskProfile: 2, jurisdiction: 'HK', validUntil: '4102444800', ...extra,
});

describe('bank KYA attestation check', () => {
  it('refuses a KYA without a quote', async () => {
    const { address } = await signer(`/v1/agents/${ACCOUNT}/address?v=1`);
    const r = await bank('/kya', kya(address, { agentMeasurement: keccak256(toHex('x')) }));
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/quote/);
  });

  it('refuses a quote bound to another nonce, and a nonce it did not issue', async () => {
    const { nonce } = (await bank('/kya/nonce', { account: ACCOUNT })).body;
    const other = keccak256(toHex('not-the-bank-nonce'));
    const q = await signer(`/v1/agents/${ACCOUNT}/attest`, { nonce: other, keyVersion: 1 });
    expect((await bank('/kya', kya(q.address, { quote: q.quote, nonce }))).body.detail).toMatch(/report data/);
    expect((await bank('/kya', kya(q.address, { quote: q.quote, nonce: other }))).body.detail).toMatch(/nonce/);
  });

  it('refuses a quote of another key than the agent key claimed', async () => {
    const { nonce } = (await bank('/kya/nonce', { account: ACCOUNT })).body;
    const q = await signer(`/v1/agents/${ACCOUNT}/attest`, { nonce, keyVersion: 2 });
    const { address: v1 } = await signer(`/v1/agents/${ACCOUNT}/address?v=1`);
    expect((await bank('/kya', kya(v1, { quote: q.quote, nonce }))).status).toBe(400);
  });
});
