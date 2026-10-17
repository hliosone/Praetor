// The public entry's browser hardening (spec 08, web attacker): the web app may run scripts only from its own origin
// and cannot be framed; every response carries HSTS and nosniff.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const caddy = readFileSync(new URL('../../infra/Caddyfile', import.meta.url), 'utf8');

describe('infra/Caddyfile', () => {
  it('sends a CSP with scripts from self only and no framing for the web app', () => {
    const csp = /Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1] ?? '';
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it('sends HSTS, nosniff and no referrer on every response', () => {
    for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options "nosniff"', 'Referrer-Policy "no-referrer"']) expect(caddy).toContain(h);
  });
});
