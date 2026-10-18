import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createMcpApp, inSubnet, type TokenStore } from '../src/app.js';
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
  explorer: 'x', reader: { status: async () => ({ effective: 0, account: 0, global: 0, heartbeatValidUntil: 2n }), kya: async () => ({ agentKey: '0x0', validUntil: 2n, riskProfile: 2 }), now: async () => 1n },
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
    expect(names).toEqual(['explain', 'get_activity', 'get_approval', 'get_mandate', 'get_portfolio', 'get_status', 'pay', 'propose_standing_order', 'rebalance', 'trigger_standing_order']);
    const call = await mcp(a, t, rpc('tools/call', { name: 'get_status', arguments: {} })).expect(200);
    expect(parse(call.text).result.content[0].text).toMatch(/Status: ACTIVE/);
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
