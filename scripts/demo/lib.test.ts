import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { softPasskey } from '@praetor/protocol';
import { chainSet, devStaff, fiscoDeploymentsFile, publicOrigin, root, type Stack } from './lib.js';

const envFile = (p: string) => Object.fromEntries(readFileSync(`${root}${p}`, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const example = envFile('infra/.env.example');

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

describe('stack: the chain mode, as scripts/dev/compose-env.sh resolves it', () => {
  it('is the fork unless CHAIN_MODE says live, from the shell first, then .env', () => {
    expect(chainSet({}, {})).toBe('LOCAL');
    expect(chainSet({ CHAIN_MODE: 'live' }, {})).toBe('LIVE');
    expect(chainSet({}, { CHAIN_MODE: 'live' })).toBe('LIVE');
    expect(chainSet({ CHAIN_MODE: 'live' }, { CHAIN_MODE: 'fork' })).toBe('LOCAL');
  });
});

describe('scripted staff passkeys: public labels on the fork, a per-deployment secret on live', () => {
  const at = (set: Stack['set'], env: Record<string, string>) => ({ set, env, rpId: 'app.example.org', origin: 'https://app.example.org' }) as Stack;
  const pub = softPasskey('praetor-dev-staff-bank', 'app.example.org', 'https://app.example.org');

  it('keeps the public label on the fork and in the tests (unchanged)', () => {
    const k = devStaff(at('LOCAL', { STAFF_ENROL_TOKEN_BANK: 'test-token-bank' }), 'bank');
    expect([k.x, k.y, k.credIdHash]).toEqual([pub.x, pub.y, pub.credIdHash]);
  });

  it('on live, derives a key nobody can get from the repo: it differs from the public label and needs the token', () => {
    const k = devStaff(at('LIVE', { STAFF_ENROL_TOKEN_BANK: 'test-token-bank' }), 'bank');
    expect(k.x).not.toBe(pub.x);
    expect(k.credIdHash).not.toBe(pub.credIdHash);
    const other = devStaff(at('LIVE', { STAFF_ENROL_TOKEN_BANK: 'another-token' }), 'bank');
    expect(other.x).not.toBe(k.x);
    expect(devStaff(at('LIVE', { STAFF_ENROL_TOKEN_BANK: 'test-token-bank' }), 'bank').x).toBe(k.x);
    expect(devStaff(at('LIVE', { STAFF_ENROL_TOKEN_REGULATOR: 'test-token-bank' }), 'regulator').x).not.toBe(k.x);
  });

  it('on live, refuses without the token instead of falling back to the public label', () => {
    expect(() => devStaff(at('LIVE', {}), 'bank')).toThrow(/STAFF_ENROL_TOKEN_BANK/);
    expect(() => devStaff(at('LIVE', { STAFF_ENROL_TOKEN_BANK: '' }), 'bank')).toThrow(/STAFF_ENROL_TOKEN_BANK/);
  });

  it('never puts the token itself in the credential id (softPasskey writes its label there in clear)', () => {
    const k = devStaff(at('LIVE', { STAFF_ENROL_TOKEN_OPERATOR: 'test-token-operator' }), 'operator');
    expect(Buffer.from(k.credentialId, 'base64url').toString()).not.toContain('test-token-operator');
  });
});

describe('activateSoterAttester: the FISCO deployment the services read in each mode', () => {
  it('fisco-local on the fork, fisco-live on live (FISCO_DEPLOYMENTS_FILE of infra/.env.example and infra/live.env)', () => {
    expect(fiscoDeploymentsFile({ set: 'LOCAL' })).toBe(`${root}${example.FISCO_DEPLOYMENTS_FILE}`);
    expect(fiscoDeploymentsFile({ set: 'LIVE' })).toBe(`${root}${envFile('infra/live.env').FISCO_DEPLOYMENTS_FILE}`);
  });
});
