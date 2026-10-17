import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { getAddress, concat, decodeFunctionData, keccak256, parseAbi, parseTransaction, recoverAddress, hashMessage, toHex, bytesToHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signCaller } from '@praetor/protocol/caller-auth';
import { encodeExecute, toJson, ENTRY_POINT, type UserOp } from '@praetor/userop';
import { createSignerApp, type KeySource } from '../src/app.js';
import { weidKeyMultibase } from '../src/weid.js';

const secrets = { mcp: 'm'.repeat(64), api: 'a'.repeat(64), bank: 'b'.repeat(64) };
const ACCOUNT = getAddress('0x00000000000000000000000000000000000c0ffe');
const keyOf = (path: string) => keccak256(toHex(path));
const keys: KeySource = {
  getKey: async (path) => keyOf(path),
  quote: async (reportData) => ({ quote: `0xfeed${bytesToHex(reportData).slice(2)}` }),
  info: async () => ({ appId: 'app', composeHash: 'compose' }),
};
const agentAddr = (v = 1) => privateKeyToAccount(keyOf(`praetor/agent/${ACCOUNT.toLowerCase()}/v${v}`)).address;

let app: ReturnType<typeof createSignerApp>;
beforeEach(() => {
  app = createSignerApp({ keys, secrets, simulator: true, version: 't', mcpUrl: 'https://praetor.localhost/mcp', rateLimitPerHour: 3 });
});

function call(caller: keyof typeof secrets, method: 'GET' | 'POST', path: string, body?: unknown) {
  const raw = Buffer.from(body === undefined ? '' : JSON.stringify(body));
  const h = signCaller(caller, secrets[caller], method, path, raw);
  const r = method === 'GET' ? request(app).get(path) : request(app).post(path).set('content-type', 'application/json').send(raw.toString());
  return r.set(h);
}

describe('auth', () => {
  it('requires a caller HMAC', async () => {
    await request(app).get(`/v1/agents/${ACCOUNT}/address`).expect(401);
  });
  it('limits each route to its callers', async () => {
    await call('mcp', 'GET', `/v1/agents/${ACCOUNT}/address?v=1`).expect(403);
    await call('api', 'POST', `/v1/agents/${ACCOUNT}/sign-userop`, {}).expect(403);
    await call('mcp', 'POST', `/v1/agents/${ACCOUNT}/sign-weid`, {}).expect(403);
  });
  it('a captured request cannot be replayed', async () => {
    const path = `/v1/agents/${ACCOUNT}/address?v=1`;
    const h = signCaller('api', secrets.api, 'GET', path, Buffer.alloc(0));
    await request(app).get(path).set(h).expect(200);
    await request(app).get(path).set(h).expect(401);
  });
});

describe('keys', () => {
  it('derives the agent address per account and key version, the same every time', async () => {
    const a = await call('api', 'GET', `/v1/agents/${ACCOUNT}/address?v=1`).expect(200);
    expect(a.body.address).toBe(agentAddr(1));
    const b = await call('bank', 'GET', `/v1/agents/${ACCOUNT.toLowerCase()}/address?v=1`).expect(200);
    expect(b.body.address).toBe(agentAddr(1));
    const c = await call('api', 'GET', `/v1/agents/${ACCOUNT}/address?v=2`).expect(200);
    expect(c.body.address).toBe(agentAddr(2));
  });

  it('attests with reportData = keccak256(address || nonce)', async () => {
    const nonce = keccak256(toHex('n1'));
    const r = await call('api', 'POST', `/v1/agents/${ACCOUNT}/attest`, { nonce, keyVersion: 1 }).expect(200);
    expect(r.body.address).toBe(agentAddr(1));
    expect(r.body.quote).toBe(`0xfeed${keccak256(concat([agentAddr(1), nonce])).slice(2)}`);
  });

  it('info says simulator from its own config', async () => {
    expect((await call('api', 'GET', '/v1/info').expect(200)).body).toEqual({ appId: 'app', composeHash: 'compose', simulator: true, version: 't' });
  });
});

describe('sign-userop (mcp only)', () => {
  const op = (o: Partial<UserOp> = {}): UserOp => ({
    sender: ACCOUNT, nonce: 0n, callData: encodeExecute([{ to: '0x0000000000000000000000000000000000000bee', value: 0n, data: '0x' }]),
    callGasLimit: 300000n, verificationGasLimit: 300000n, preVerificationGas: 60000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, signature: '0x', ...o,
  } as UserOp);

  it('signs the userOpHash it computes itself, as the agent key (eth_sign over the hash)', async () => {
    const { userOpHash } = await import('@praetor/userop');
    const r = await call('mcp', 'POST', `/v1/agents/${ACCOUNT}/sign-userop`, { userOp: toJson(op()), chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: 1 }).expect(200);
    expect(await recoverAddress({ hash: hashMessage({ raw: userOpHash(op()) }), signature: r.body.signature })).toBe(agentAddr(1));
  });

  it('refuses another sender, a non-execute call, a call to the account itself, another chain or entry point', async () => {
    const p = `/v1/agents/${ACCOUNT}/sign-userop`;
    const base = { chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: 1 };
    await call('mcp', 'POST', p, { ...base, userOp: toJson(op({ sender: '0x00000000000000000000000000000000000000aa' })) }).expect(400);
    await call('mcp', 'POST', p, { ...base, userOp: toJson(op({ callData: '0x12345678' })) }).expect(400);
    await call('mcp', 'POST', p, { ...base, userOp: toJson(op({ callData: encodeExecute([{ to: ACCOUNT, value: 0n, data: '0x' }]) })) }).expect(400);
    await call('mcp', 'POST', p, { ...base, chainId: 1, userOp: toJson(op()) }).expect(400);
    await call('mcp', 'POST', p, { ...base, entryPoint: '0x0000000000000000000000000000000000000001', userOp: toJson(op()) }).expect(400);
  });

  it('rate-limits per account', async () => {
    const p = `/v1/agents/${ACCOUNT}/sign-userop`;
    for (let i = 0; i < 3; i++) await call('mcp', 'POST', p, { userOp: toJson(op({ nonce: BigInt(i) })), chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: 1 }).expect(200);
    await call('mcp', 'POST', p, { userOp: toJson(op({ nonce: 9n })), chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: 1 }).expect(429);
  });
});

describe('sign-weid (bank only)', () => {
  const weid = () => `did:weid:101:${agentAddr(1).toLowerCase()}`;
  const agentPub = () => privateKeyToAccount(keyOf(`praetor/agent/${ACCOUNT.toLowerCase()}/v1`)).publicKey;
  const ownAuth = () => `${weid()}#keys-1234abcd,Ed25519VerificationKey2020,${weid()},${weidKeyMultibase(agentPub())}`;
  const updateAbi = parseAbi(['function updateWeId(address identity, string updated, string[] authentication, string[] service)']);
  const svcBody = (o: Record<string, unknown> = {}) => ({
    kind: 'addService', keyVersion: 1,
    fields: { weIdContract: '0x76e95182042d96160342ab6370919c6523c1895e', nonce: 3, updated: '1792236400', authentication: [ownAuth()], service: [], add: [{ type: 'AgentWallet', endpoint: `eip155:84532:${ACCOUNT}` }, { type: 'MCP', endpoint: 'https://praetor.localhost/mcp' }], ...o },
  });

  it('createDid returns the agent public key (X||Y, base64) for createWeIdWithPubKey', async () => {
    const r = await call('bank', 'POST', `/v1/agents/${ACCOUNT}/sign-weid`, { kind: 'createDid', keyVersion: 1, fields: {} }).expect(200);
    const pub = privateKeyToAccount(keyOf(`praetor/agent/${ACCOUNT.toLowerCase()}/v1`)).publicKey;
    expect(r.body).toEqual({ address: agentAddr(1), publicKeyECDSA: Buffer.from(pub.slice(4), 'hex').toString('base64') });
  });

  it('addService signs, as the agent key, a FISCO tx calling updateWeId with the two Praetor services', async () => {
    const r = await call('bank', 'POST', `/v1/agents/${ACCOUNT}/sign-weid`, svcBody()).expect(200);
    const tx = parseTransaction(r.body.rawTx as Hex);
    expect(tx.to).toBe('0x76e95182042d96160342ab6370919c6523c1895e');
    expect(tx.chainId).toBe(20200);
    expect(tx.gasPrice ?? 0n).toBe(0n); // viem parses an RLP-empty gas price as undefined
    expect(tx.nonce).toBe(3);
    const { args } = decodeFunctionData({ abi: updateAbi, data: tx.data! });
    expect(args[0]).toBe(agentAddr(1));
    expect(args[2]).toEqual([ownAuth()]);
    expect(args[3]).toHaveLength(2);
    expect(args[3]![0]).toMatch(new RegExp(`^${weid()}#[0-9a-f]{8},AgentWallet,eip155:84532:${ACCOUNT}$`));
    expect(args[3]![1]).toMatch(new RegExp(`^${weid()}#[0-9a-f]{8},MCP,https://praetor.localhost/mcp$`));
    const { recoverTransactionAddress } = await import('viem');
    expect(await recoverTransactionAddress({ serializedTransaction: r.body.rawTx })).toBe(agentAddr(1));
  });

  it('refuses an authentication list other than the agent key alone, another wallet, another MCP host or another service type', async () => {
    const p = `/v1/agents/${ACCOUNT}/sign-weid`;
    await call('bank', 'POST', p, svcBody({ authentication: [ownAuth(), `${weid()}#keys-9,Ed25519VerificationKey2020,did:weid:101:0x00000000000000000000000000000000000000ba,zX`] })).expect(400);
    await call('bank', 'POST', p, svcBody({ authentication: [`${weid()}#keys-1234abcd,Ed25519VerificationKey2020,${weid()},${weidKeyMultibase(privateKeyToAccount(keyOf('mallory')).publicKey)}`] })).expect(400);
    await call('bank', 'POST', p, svcBody({ add: [{ type: 'AgentWallet', endpoint: 'eip155:84532:0x00000000000000000000000000000000000000aa' }] })).expect(400);
    await call('bank', 'POST', p, svcBody({ add: [{ type: 'MCP', endpoint: 'https://evil.example/mcp' }] })).expect(400);
    await call('bank', 'POST', p, svcBody({ add: [{ type: 'Payout', endpoint: 'x' }] })).expect(400);
  });

  it('never returns key material', async () => {
    const r = await call('bank', 'POST', `/v1/agents/${ACCOUNT}/sign-weid`, svcBody()).expect(200);
    expect(JSON.stringify(r.body)).not.toContain(keyOf(`praetor/agent/${ACCOUNT.toLowerCase()}/v1`).slice(2));
  });
});
