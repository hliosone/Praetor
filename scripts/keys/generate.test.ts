import { describe, it, expect } from 'vitest';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { KEY_SETS, WALLET_ROLES, plannedNames, fillEnv, parseEnv, publicAddresses } from './lib.js';

const HUMAN = `# human values
MP_APPID=wx123
MP_SECRET=
OPENCODE_API_KEY=
`;

describe('key plan', () => {
  it('has one prefixed copy of every wallet role per set, plus the shared secrets', () => {
    const names = plannedNames();
    for (const set of KEY_SETS) for (const role of WALLET_ROLES) expect(names).toContain(`${set}_${role}`);
    for (const shared of ['SESSION_SECRET', 'KYC_ENC_KEY', 'SIGNER_HMAC_MCP', 'VAPID_PRIVATE', 'MYSQL_ROOT_PASSWORD', 'OPENCODE_SERVER_PASSWORD'])
      expect(names).toContain(shared);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has a bundler database password and internal service tokens (D22)', () => {
    const names = plannedNames();
    expect(names).toContain('MYSQL_PASSWORD_BUNDLER');
    expect(names).toContain('INTERNAL_TOKEN_BUNDLER');
  });

  it('has staff enrolment tokens per member service and an internal token for member services (Q28, D24)', () => {
    for (const n of ['STAFF_ENROL_TOKEN_BANK', 'STAFF_ENROL_TOKEN_REGULATOR', 'STAFF_ENROL_TOKEN_OPERATOR', 'INTERNAL_TOKEN_MEMBERS', 'INTERNAL_TOKEN_MCP', 'INTERNAL_TOKEN_AGENT', 'INTERNAL_TOKEN_API']) {
      expect(plannedNames()).toContain(n);
    }
  });

  it('has a FISCO account for the bridge-relayer in every set (D23)', () => {
    for (const set of KEY_SETS) expect(plannedNames()).toContain(`${set}_RELAYER_FISCO_KEY`);
  });

  it('has fixed FISCO keys for the WeIdentity admin and the WeCross stub in every set (Q32, Q40)', () => {
    const names = plannedNames();
    for (const set of KEY_SETS) {
      expect(names).toContain(`${set}_WEID_ADMIN_KEY`);
      expect(names).toContain(`${set}_WECROSS_FISCO_KEY`);
    }
  });
});

describe('fillEnv', () => {
  it('fills every planned name with a distinct non-empty value', () => {
    const { text, added } = fillEnv('');
    const env = parseEnv(text);
    expect(added.sort()).toEqual(plannedNames().sort());
    for (const n of plannedNames()) expect(env[n], n).toBeTruthy();
    const wallet = KEY_SETS.flatMap((s) => WALLET_ROLES.map((r) => env[`${s}_${r}`]!));
    for (const k of wallet) expect(k).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(wallet).size).toBe(wallet.length);
  });

  it('is idempotent: a second run adds nothing and changes nothing', () => {
    const first = fillEnv(HUMAN);
    const second = fillEnv(first.text);
    expect(second.added).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  it('keeps human lines and existing generated values byte for byte', () => {
    const preset = `${HUMAN}LIVE_DEPLOYER_KEY=0x${'11'.repeat(32)}\n`;
    const { text } = fillEnv(preset);
    expect(text.startsWith(preset)).toBe(true);
    expect(parseEnv(text).LIVE_DEPLOYER_KEY).toBe(`0x${'11'.repeat(32)}`);
    expect(parseEnv(text).MP_SECRET).toBe('');
  });

  it('fills an empty generated entry in place instead of duplicating it', () => {
    const { text } = fillEnv(`${HUMAN}SESSION_SECRET=\n`);
    expect(text.match(/^SESSION_SECRET=/gm)).toHaveLength(1);
    expect(parseEnv(text).SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces usable key material for VAPID, Alipay+ RSA and the EUDI verifier', () => {
    const env = parseEnv(fillEnv('').text);
    expect(Buffer.from(env.VAPID_PUBLIC!, 'base64url')).toHaveLength(65);
    expect(Buffer.from(env.VAPID_PUBLIC!, 'base64url')[0]).toBe(4);
    expect(Buffer.from(env.VAPID_PRIVATE!, 'base64url')).toHaveLength(32);
    const der = (b64: string) => Buffer.from(b64, 'base64');
    expect(createPrivateKey({ key: der(env.ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY!), format: 'der', type: 'pkcs8' }).asymmetricKeyType).toBe('rsa');
    expect(createPublicKey({ key: der(env.ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY!), format: 'der', type: 'spki' }).asymmetricKeyType).toBe('rsa');
    const cert = new X509Certificate(Buffer.from(env.EUDI_VERIFIER_CERT!, 'base64').toString('utf8'));
    expect(cert.subjectAltName).toContain('DNS:');
    expect(createPrivateKey(Buffer.from(env.EUDI_VERIFIER_KEY!, 'base64').toString('utf8')).asymmetricKeyType).toBe('ec');
  });
});

describe('publicAddresses', () => {
  it('derives addresses and never echoes private material', () => {
    const env = parseEnv(fillEnv('').text);
    const rows = publicAddresses(env);
    const live = rows.find((r) => r.name === 'LIVE_BUNDLER_KEY')!;
    expect(live.address).toBe(privateKeyToAccount(env.LIVE_BUNDLER_KEY as `0x${string}`).address);
    const dump = JSON.stringify(rows);
    for (const set of KEY_SETS) for (const role of WALLET_ROLES) expect(dump).not.toContain(env[`${set}_${role}`]!.slice(2));
  });
});

describe('CLI', () => {
  it('writes the env file with mode 600 and prints addresses only', () => {
    const dir = fileURLToPath(new URL('../../.run', import.meta.url));
    mkdirSync(dir, { recursive: true });
    const tmp = mkdtempSync(join(dir, 'keys-'));
    const file = join(tmp, '.env');
    writeFileSync(file, HUMAN, { mode: 0o644 });
    const out = execFileSync('npx', ['tsx', fileURLToPath(new URL('./generate.ts', import.meta.url))], { env: { ...process.env, PRAETOR_ENV_FILE: file }, encoding: 'utf8' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const env = parseEnv(readFileSync(file, 'utf8'));
    expect(out).not.toContain(env.LIVE_DEPLOYER_KEY!.slice(2));
    expect(out).not.toContain(env.SESSION_SECRET!);
    expect(out).toContain(privateKeyToAccount(env.LIVE_DEPLOYER_KEY as `0x${string}`).address);
  });
});
