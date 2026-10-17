// Phones against the local stack (spec 11): `make tunnel` starts a cloudflared quick tunnel in front of Caddy with the
// flags proven in Phase 0, keeps one instance, and points the mini program's develop base at its URL.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('make tunnel', () => {
  it('runs scripts/dev/tunnel.sh (no longer a stub) and can be stopped', () => {
    const mk = read('Makefile');
    expect(mk).toMatch(/^tunnel:[^\n]*\n\tbash scripts\/dev\/tunnel\.sh/m);
    expect(mk).toMatch(/^tunnel-stop:/m);
  });

  it('tunnels to Caddy with the Phase 0 flags and the public host, writes the URL and sets the mini program base', () => {
    const sh = read('scripts/dev/tunnel.sh');
    for (const f of ['--protocol http2', '--edge-ip-version 4', '--http-host-header', '.run/tunnel-url', '@praetor/miniprogram tunnel']) expect(sh).toContain(f);
  });
});
