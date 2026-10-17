// M6 links: weid-deploy -> FISCO, weid-rest -> FISCO, weid-helper -> FISCO and the REST custodial keys.
import { describe, it, expect } from 'vitest';
import { compose } from './lib/stack.js';

// Both services are reachable only on the compose network: call them from the bank container (Node 22 fetch).
const post = (url: string, body: unknown) =>
  JSON.parse(compose('exec', '-T', 'bank', 'node', '-e',
    `fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.text()).then(t => console.log(t))`));

const rest = (functionName: string, functionArg: unknown, transactionArg: unknown = {}) =>
  post('http://weid-rest:6001/weid/api/invoke', { functionName, functionArg, transactionArg, v: '1.0.0' });

describe('WeIdentity', () => {
  it('weid-rest creates a WeID on the consortium chain', () => {
    const r = rest('createWeId', {});
    expect(r.errorCode).toBe(0);
    expect(r.respBody).toMatch(/^did:weid:101:0x[0-9a-fA-F]{40}$/);
  });

  it('weid-helper reads the chain with the deployment config', () => {
    expect(post('http://weid-helper:6100/health', {})).toEqual({ ok: true });
  });

  it("runs Alex's scenario: 43 steps pass, none fails", () => {
    const out = compose('--profile', 'tools', 'run', '--rm', '--build', '-T', 'weid-scenario');
    const rows = out.split('\n').map((l) => l.replace(/^RESULT /, '').split('\t')).filter((c) => c.length >= 4 && ['PASS', 'FAIL', 'INFO'].includes(c[2] ?? ''));
    const failed = rows.filter((c) => c[2] === 'FAIL').map((c) => `${c[0]}: ${c[4]}`);
    expect(failed).toEqual([]);
    expect(rows.filter((c) => c[2] === 'PASS').length).toBeGreaterThanOrEqual(43);
  }, 600_000);
});
