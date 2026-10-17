// M5 links: member services to their database, FISCO and Base; bridge-relayer to the outbox and the bundler.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose, dotenv } from './lib/stack.js';

// The transport the stack runs: .env overrides infra/.env.example (local default: wecross, D42).
const bridge = (): string => {
  const example = readFileSync(new URL('../../infra/.env.example', import.meta.url), 'utf8').match(/^BRIDGE=(\w+)/m)?.[1];
  return dotenv().BRIDGE ?? example ?? 'relayer';
};

const health = (svc: string, port: number) =>
  JSON.parse(compose('exec', '-T', svc, 'node', '-e', `fetch('http://127.0.0.1:${port}/health').then(r => r.text()).then(t => console.log(t))`));

describe('member services', () => {
  for (const svc of ['bank', 'regulator', 'operator']) {
    it(`${svc} reaches FISCO, Base and its own database`, () => {
      expect(health(svc, 3020)).toEqual({ ok: true, fisco: true, base: true, db: true });
    });
  }

  it('refuse callers without the internal token', () => {
    const out = compose('exec', '-T', 'regulator', 'node', '-e', "fetch('http://127.0.0.1:3020/status', { method: 'POST' }).then(r => console.log(r.status))");
    expect(out.trim()).toBe('401');
  });
});

describe('bridge-relayer', () => {
  it('polls the FISCO outbox (fresh tick) in the configured transport mode', () => {
    expect(health('bridge-relayer', 3030)).toMatchObject({ ok: true, mode: bridge() });
  });
});
