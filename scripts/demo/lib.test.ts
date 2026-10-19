import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { publicOrigin, root } from './lib.js';

const example = Object.fromEntries(readFileSync(`${root}infra/.env.example`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

describe('stack: the WebAuthn host the member services and the api check assertions against', () => {
  it('defaults to the local host of infra/.env.example', () => {
    expect(publicOrigin({}, {})).toEqual({ rpId: example.PUBLIC_HOST, origin: example.PUBLIC_URL });
    expect(publicOrigin({}, {})).toEqual({ rpId: 'praetor.localhost', origin: 'https://praetor.localhost' });
  });

  it('follows PUBLIC_HOST and PUBLIC_URL from .env, where compose takes them for the services', () => {
    expect(publicOrigin({ PUBLIC_HOST: 'app.example.org', PUBLIC_URL: 'https://app.example.org' }, {})).toEqual({ rpId: 'app.example.org', origin: 'https://app.example.org' });
  });

  it('lets the shell override .env, as compose does', () => {
    const file = { PUBLIC_HOST: 'a.example.org', PUBLIC_URL: 'https://a.example.org' };
    expect(publicOrigin(file, { PUBLIC_HOST: 'b.example.org', PUBLIC_URL: 'https://b.example.org' })).toEqual({ rpId: 'b.example.org', origin: 'https://b.example.org' });
  });
});
