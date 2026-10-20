import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createMcpApp, inSubnet, type TokenStore } from '../src/app.js';
import { encodeFunctionData, erc20Abi } from 'viem';
import { TreasuryDeskAbi } from '@praetor/chain';
import { callHash } from '@praetor/protocol';
import type { Ports } from '../src/tools.js';

const ACCOUNT = '0x00000000000000000000000000000000000c0ffe';
class MemTokens implements TokenStore {
  agent = new Map<string, string>();
  labels: unknown[] = [];
  async issueAgent(account: string) { const t = `agt_${account}`; this.agent.set(t, account); return t; }
  async agentAccount(token: string) { return this.agent.get(token) ?? null; }
  async oauthAccount() { return null; }
  async setLabels(account: string, labels: { address: string; label: string }[]) { this.labels.push({ account, labels }); }
}
const ports = {
  tokens: { usdc: '0x00000000000000000000000000000000000000a1', txau: '0x00000000000000000000000000000000000000a2', txag: '0x00000000000000000000000000000000000000a3', desk: '0x00000000000000000000000000000000000000d5' },
  explorer: 'x', reader: { status: async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 2n }), ownerHold: async () => ({ paused: false, recoveryPending: false }), kya: async () => ({ agentKey: '0x0', validUntil: 2n, riskProfile: 2 }), now: async () => 1n },
} as unknown as Ports;

function app(remote = '10.90.0.5') {
  const tokens = new MemTokens();
  const a = createMcpApp({ tokens, ports: () => ports, internalToken: 'int-token', apiToken: 'api-token', agentSubnet: '10.90.0.0/24', baseUrl: 'https://praetor.localhost', remoteAddress: () => remote, liveApproval: async () => true });
  return { a, tokens };
}
const rpc = (method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const mcp = (a: ReturnType<typeof app>["a"], token: string, body: object) =>
  request(a).post('/mcp').set('authorization', `Bearer ${token}`).set('accept', 'application/json, text/event-stream').set('content-type', 'application/json').send(body);
const parse = (text: string) => JSON.parse(text.split('\n').find((l) => l.startsWith('data: '))!.slice(6));

describe('subnet check', () => {
  it('matches IPv4 and IPv4-mapped IPv6 addresses', () => {
    expect(inSubnet('10.90.0.7', '10.90.0.0/24')).toBe(true);
    expect(inSubnet('::ffff:10.90.0.7', '10.90.0.0/24')).toBe(true);
    expect(inSubnet('10.88.0.7', '10.90.0.0/24')).toBe(false);
    expect(inSubnet(undefined, '10.90.0.0/24')).toBe(false);
  });
  it('a /32 admits agent-runner alone, not the Docker host\'s bridge gateway (red team D62)', () => {
    expect(inSubnet('10.90.0.10', '10.90.0.10/32')).toBe(true);
    expect(inSubnet('10.90.0.1', '10.90.0.10/32')).toBe(false);
  });
});

describe('resubmission of an approved call (F6 step 8)', () => {
  it('the api resubmits the exact calls with the agent key, behind its own token', async () => {
    const sent: unknown[] = [];
    const tokens = new MemTokens();
    const p = { ...ports, submit: async (account: string, calls: unknown[]) => { sent.push({ account, calls }); return { userOpHash: '0x1', txHash: '0x2', success: true, reasons: [], refusalLogTx: null }; } } as unknown as Ports;
    const a = createMcpApp({ tokens, ports: () => p, internalToken: 'int-token', apiToken: 'api-token', agentSubnet: '10.90.0.0/24', baseUrl: 'https://praetor.localhost', liveApproval: async () => true });
    const body = { account: ACCOUNT, calls: [{ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', value: '0', data: '0xa9059cbb' }] };
    await request(a).post('/internal/resubmit').set('authorization', 'Bearer int-token').send(body).expect(401);
    const r = await request(a).post('/internal/resubmit').set('authorization', 'Bearer api-token').send(body).expect(200);
    expect(r.body).toMatchObject({ success: true, txHash: '0x2' });
    expect(sent).toEqual([{ account: ACCOUNT, calls: [{ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', value: 0n, data: '0xa9059cbb' }] }]);
  });
});

describe('resubmission needs the owner\'s live approval on Base', () => {
  it('refuses a call without a live, unconsumed approval for its callHash, and a batch', async () => {
    const sent: unknown[] = [];
    const asked: unknown[] = [];
    const p = { ...ports, submit: async (account: string, calls: unknown[]) => { sent.push({ account, calls }); return { userOpHash: '0x1', txHash: '0x2', success: true, reasons: [], refusalLogTx: null }; } } as unknown as Ports;
    const a = createMcpApp({
      tokens: new MemTokens(), ports: () => p, internalToken: 'int-token', apiToken: 'api-token', agentSubnet: '10.90.0.0/24', baseUrl: 'https://praetor.localhost',
      liveApproval: async (account, hash) => { asked.push({ account, hash }); return false; },
    });
    const one = { to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, value: '0', data: '0xa9059cbb' as const };
    await request(a).post('/internal/resubmit').set('authorization', 'Bearer api-token').send({ account: ACCOUNT, calls: [one] }).expect(409);
    expect(asked).toEqual([{ account: ACCOUNT, hash: callHash({ account: ACCOUNT, target: one.to, value: 0n, data: one.data }) }]);
    await request(a).post('/internal/resubmit').set('authorization', 'Bearer api-token').send({ account: ACCOUNT, calls: [one, one] }).expect(400);
    expect(sent).toEqual([]);
  });
});

describe('resubmission of an owner-approved rebalance (F4 failures, F6 step 8)', () => {
  const T = ports.tokens as { txau: `0x${string}`; txag: `0x${string}`; usdc: `0x${string}`; desk: `0x${string}` };
  const approve = (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => ({ to: token, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }) });
  const swap = (tokenIn: `0x${string}`, amountIn: bigint) => ({ to: T.desk, value: '0', data: encodeFunctionData({ abi: TreasuryDeskAbi, functionName: 'swap', args: [tokenIn, T.usdc, amountIn, 1n] }) });
  const setup = (live: boolean) => {
    const sent: unknown[] = [];
    const asked: unknown[] = [];
    const p = { ...ports, submit: async (account: string, calls: unknown[]) => { sent.push({ account, calls }); return { userOpHash: '0x1', txHash: '0x2', success: true, reasons: [], refusalLogTx: null }; } } as unknown as Ports;
    const a = createMcpApp({
      tokens: new MemTokens(), ports: () => p, internalToken: 'int-token', apiToken: 'api-token', agentSubnet: '10.90.0.0/24', baseUrl: 'https://praetor.localhost',
      liveApproval: async (account, hash) => { asked.push({ account, hash }); return live; },
    });
    const post = (calls: unknown[]) => request(a).post('/internal/resubmit').set('authorization', 'Bearer api-token').send({ account: ACCOUNT, calls });
    return { sent, asked, post };
  };
  const swapHash = (c: { to: `0x${string}`; data: `0x${string}` }) => callHash({ account: ACCOUNT as `0x${string}`, target: c.to, value: 0n, data: c.data });

  it('resubmits [token.approve(desk, x), desk.swap(token, ..., x, ...)] when the swap, the call the hook decides on, has the live approval', async () => {
    const { sent, asked, post } = setup(true);
    const calls = [approve(T.txau, T.desk, 5n), swap(T.txau, 5n)];
    await post(calls).expect(200);
    expect(asked).toEqual([{ account: ACCOUNT, hash: swapHash(calls[1]!) }]);
    expect(sent).toEqual([{ account: ACCOUNT, calls: calls.map((c) => ({ ...c, value: 0n })) }]);
  });

  it('409 without a live approval for the swap', async () => {
    const { sent, post } = setup(false);
    await post([approve(T.txau, T.desk, 5n), swap(T.txau, 5n)]).expect(409);
    expect(sent).toEqual([]);
  });

  it('400 for any other pair: another spender, amount or token than the swap\'s, or a first call that is not an approve', async () => {
    const { sent, asked, post } = setup(true);
    await post([approve(T.txau, T.txag, 5n), swap(T.txau, 5n)]).expect(400);
    await post([approve(T.txau, T.desk, 6n), swap(T.txau, 5n)]).expect(400);
    await post([approve(T.txag, T.desk, 5n), swap(T.txau, 5n)]).expect(400);
    await post([swap(T.txau, 5n), swap(T.txau, 5n)]).expect(400);
    await post([{ ...approve(T.txau, T.desk, 5n), value: '1' }, swap(T.txau, 5n)]).expect(400);
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('mcp app', () => {
  it('issues an agent bearer only with the internal token', async () => {
    const { a } = app();
    await request(a).post('/internal/agent-token').send({ account: ACCOUNT }).expect(401);
    const r = await request(a).post('/internal/agent-token').set('authorization', 'Bearer int-token').send({ account: ACCOUNT }).expect(200);
    expect(r.body.token).toBe(`agt_${ACCOUNT}`);
  });

  it('serves the Praetor tools to the agent bearer from the agent network', async () => {
    const { a, tokens } = app();
    const t = await tokens.issueAgent(ACCOUNT);
    const list = await mcp(a, t, rpc('tools/list')).expect(200);
    const names = parse(list.text).result.tools.map((x: { name: string }) => x.name).sort();
    expect(names).toEqual(['explain', 'get_activity', 'get_approval', 'get_mandate', 'get_portfolio', 'get_status', 'pay', 'propose_standing_order', 'rebalance', 'trigger_standing_order', 'x402_fetch']);
    const call = await mcp(a, t, rpc('tools/call', { name: 'get_status', arguments: {} })).expect(200);
    expect(parse(call.text).result.content[0].text).toMatch(/Status: ACTIVE/);
  });

  it('describes the dry run as pass, owner approval (a payment through pay), or refused for good (#4)', async () => {
    const { a, tokens } = app();
    const list = await mcp(a, await tokens.issueAgent(ACCOUNT), rpc('tools/list')).expect(200);
    const explain = parse(list.text).result.tools.find((x: { name: string }) => x.name === 'explain').description as string;
    expect(explain).toMatch(/owner's approval/);
    expect(explain).toMatch(/for a payment, pay then sends the owner the approval request/);
    expect(explain).not.toMatch(/rebalance sends/);
    expect(explain).toMatch(/refused for good/);
    expect(explain).toMatch(/Sends nothing/);
  });

  it('get_mandate is described as the place to read what was spent (#7)', async () => {
    const { a, tokens } = app();
    const list = await mcp(a, await tokens.issueAgent(ACCOUNT), rpc('tools/list')).expect(200);
    const mandate = parse(list.text).result.tools.find((x: { name: string }) => x.name === 'get_mandate').description as string;
    expect(mandate).toMatch(/what was spent today and in the 30-day period/);
  });

  it('refuses the agent bearer from outside the agent network (through Caddy it must be OAuth)', async () => {
    const { a, tokens } = app('10.88.0.2');
    const t = await tokens.issueAgent(ACCOUNT);
    const r = await mcp(a, t, rpc('tools/list')).expect(401);
    expect(r.headers['www-authenticate']).toMatch(/resource_metadata=".*\/.well-known\/oauth-protected-resource"/);
  });

  it('refuses an unknown bearer', async () => {
    const { a } = app();
    await mcp(a, 'nope', rpc('tools/list')).expect(401);
  });
});
