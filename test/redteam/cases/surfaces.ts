// Spec 08 items 10 and 11: the MCP server (bearers, OAuth, PII in tool output) and the web surface (CSRF, XSS, foreign
// origins). These are refused by services, so "executed" is a request that was accepted (or PII that came out).
import type { CaseInput } from '../lib/case.js';

export const surfaceCases: CaseInput[] = [
  // ---------------------------------------------------------------- 10. MCP
  {
    id: 'RT-73', category: 'mcp', item: 10, fixture: 'bare',
    title: 'The agent\'s static MCP bearer used from anywhere but agent-runner (Caddy, the praetor network, the host through the agent network\'s gateway)',
    input: { kind: 'custom', name: 'mcp-agent-bearer', params: {} },
    expect: { layer: 'mcp', error: '401' },
    note: 'Minting a bearer replaces the account\'s previous one, so the case uses an address whose agent never chats. Control: the same bearer sent from inside agent-runner is accepted (D87: AGENT_SUBNET is agent-runner\'s /32).',
  },
  {
    id: 'RT-74', category: 'mcp', item: 10, fixture: 'main',
    title: 'OAuth token of account A used to act on account B (account named in the tool call)',
    input: { kind: 'custom', name: 'mcp-cross-account', params: {} },
    expect: { layer: 'mcp' },
    note: 'No tool takes an account: the token decides. B (this fixture) must not move; A is the web fixture.',
  },
  {
    id: 'RT-75', category: 'mcp', item: 10, fixture: 'web',
    title: 'OAuth authorize with a redirect_uri that is not registered (four variants)',
    input: { kind: 'custom', name: 'oauth-redirect', params: {} },
    expect: { layer: 'oauth', error: '400' },
  },
  {
    id: 'RT-76', category: 'mcp', item: 10, fixture: 'web',
    title: 'OAuth code exchanged with another redirect_uri, then with a wrong PKCE verifier, then replayed',
    input: { kind: 'custom', name: 'oauth-token', params: {} },
    expect: { layer: 'oauth', error: 'invalid_grant' },
  },
  {
    id: 'RT-77', category: 'mcp', item: 10, fixture: 'web',
    title: 'OAuth client registration with a plain-http redirect to another host',
    input: { kind: 'http', method: 'POST', url: '$mcpUrl/oauth/register', body: { client_name: 'evil', redirect_uris: ['http://evil.example/cb'], token_endpoint_auth_method: 'none' } },
    expect: { layer: 'oauth', error: '^400$' },
  },
  {
    id: 'RT-78', category: 'mcp', item: 10, fixture: 'main',
    title: 'Every read tool and the agent transcript scanned for the seeded KYC data (I9)',
    input: { kind: 'custom', name: 'pii-scan', params: {} },
    expect: { layer: 'mcp' },
  },

  // ---------------------------------------------------------------- 11. web
  {
    id: 'RT-79', category: 'web', item: 11, fixture: 'web',
    title: 'CSRF: owner action prepared with the session cookie but no CSRF header',
    input: { kind: 'http', method: 'POST', url: '$apiUrl/api/owner-actions/prepare', body: { kind: 7 }, session: true, csrf: 'missing' },
    expect: { layer: 'api', error: '^403$' },
  },
  {
    id: 'RT-80', category: 'web', item: 11, fixture: 'web',
    title: 'CSRF: owner action submitted with a forged CSRF header',
    input: {
      kind: 'http', method: 'POST', url: '$apiUrl/api/owner-actions/submit', session: true, csrf: 'forged',
      body: { ownerAction: { account: '$account', action: 7, payloadHash: '$zero32', nonce: '1', expiresAt: '$now+600', fiscoRef: '$zero32' }, payload: '0x', assertion: { id: 'x', response: { clientDataJSON: 'x', authenticatorData: 'x', signature: 'x' } } },
    },
    expect: { layer: 'api', error: '^403$' },
  },
  {
    id: 'RT-81', category: 'web', item: 11, fixture: 'web',
    title: 'CSRF: cross-site form post (urlencoded, foreign Origin) proposing a policy',
    input: {
      kind: 'http', method: 'POST', url: '$apiUrl/api/policy/propose', session: true, csrf: 'missing',
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'policy=%7B%7D',
    },
    expect: { layer: 'api', error: '^403$' },
  },
  {
    id: 'RT-82', category: 'web', item: 11, fixture: 'web',
    title: 'XSS payload in a payee label rendered on the approval page',
    input: { kind: 'custom', name: 'xss-label', params: {} },
    expect: { layer: 'web' },
  },
  {
    id: 'RT-83', category: 'web', item: 11, fixture: 'web',
    title: 'WebSocket upgrade and live-channel requests from a foreign origin',
    input: { kind: 'custom', name: 'ws-origin', params: {} },
    expect: { layer: 'api' },
    note: 'There is no WebSocket endpoint (live updates are server-sent events): the case checks that no upgrade is accepted and that the SSE chat and CORS refuse a foreign origin.',
  },
];
