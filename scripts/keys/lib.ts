// Key plan and .env filling for scripts/keys/generate.ts.
// Append-only by design: an existing non-empty value is never regenerated, because the human funds
// addresses derived from these keys and a rotation would strand those funds.
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Three separate sets so a signature made in one environment never verifies in another (spec 00).
export const KEY_SETS = ['LOCAL', 'LIVE', 'SANDBOX'] as const;

// secp256k1 keys, one copy per set. DEPLOYER deploys on both Base and FISCO; the bank FISCO account is
// also the FISCO governance admin (build_chain.sh -a), as spec 04 states.
export const WALLET_ROLES = [
  'DEPLOYER_KEY',
  'BUNDLER_KEY',
  'PAYMASTER_SIGNER_KEY',
  'ORACLE_FEEDER_KEY',
  'DESK_OPERATOR_KEY',
  'PAYOUT_PARTNER_KEY',
  'WECROSS_BASE_KEY',
  'TREASURY_KEY',
  'RECOVERY_GUARDIAN_KEY',
  'BANK_FISCO_KEY',
  'BANK_BASE_SIGNER_KEY',
  'REGULATOR_FISCO_KEY',
  'REGULATOR_BASE_SIGNER_KEY',
  'OPERATOR_FISCO_KEY',
  'OPERATOR_BASE_SIGNER_KEY',
  // Fixed instead of tool-generated: WeIdentity Build-Tools and the WeCross stub otherwise make a new
  // FISCO key per run, and the committee must open each one in the deploy whitelist (Q32, Q40).
  'WEID_ADMIN_KEY',
  'WECROSS_FISCO_KEY',
] as const;

const hex32 = () => randomBytes(32).toString('hex');
const password = () => randomBytes(24).toString('base64url');

const MYSQL_SERVICES = ['API', 'MCP', 'BANK', 'REGULATOR', 'OPERATOR', 'PAYOUT', 'WEID', 'WEBASE', 'WECROSS'] as const;

type Generator = () => Record<string, string>;

// Shared secrets: one per machine (prod generates its own on the server).
const SHARED: { names: string[]; make: Generator }[] = [
  ...['SESSION_SECRET', 'KYC_ENC_KEY', 'KYC_VENDOR_HMAC', 'MCP_OAUTH_SIGNING_KEY',
    'SIGNER_HMAC_MCP', 'SIGNER_HMAC_API', 'SIGNER_HMAC_BANK', 'ATTESTER_HMAC_API'].map((n) => ({ names: [n], make: () => ({ [n]: hex32() }) })),
  { names: ['OPENCODE_SERVER_PASSWORD'], make: () => ({ OPENCODE_SERVER_PASSWORD: password() }) },
  { names: ['MYSQL_ROOT_PASSWORD'], make: () => ({ MYSQL_ROOT_PASSWORD: password() }) },
  ...MYSQL_SERVICES.map((s) => ({ names: [`MYSQL_PASSWORD_${s}`], make: () => ({ [`MYSQL_PASSWORD_${s}`]: password() }) })),
  { names: ['VAPID_PUBLIC', 'VAPID_PRIVATE'], make: vapid },
  { names: ['ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY', 'ALIPAYPLUS_TEST_MERCHANT_PUBLIC_KEY'], make: () => rsaPair('ALIPAYPLUS_TEST_MERCHANT') },
  { names: ['ALIPAYPLUS_TEST_GATEWAY_PRIVATE_KEY', 'ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY'], make: () => rsaPair('ALIPAYPLUS_TEST_GATEWAY') },
  { names: ['EUDI_VERIFIER_KEY', 'EUDI_VERIFIER_CERT'], make: eudiVerifier },
];

// Web Push VAPID: base64url uncompressed P-256 point (65 bytes) and raw private scalar (32 bytes).
function vapid(): Record<string, string> {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return { VAPID_PUBLIC: pub.toString('base64url'), VAPID_PRIVATE: jwk.d! };
}

// Alipay+ keys are exchanged as base64 DER (PKCS#8 private, SPKI public), the format its SDKs read.
function rsaPair(prefix: string): Record<string, string> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    [`${prefix}_PRIVATE_KEY`]: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    [`${prefix}_PUBLIC_KEY`]: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

// Self-signed P-256 certificate for the OpenID4VP verifier; PEM stored base64 so it fits on one line.
function eudiVerifier(): Record<string, string> {
  const base = join(process.cwd(), '.run');
  let dir: string;
  try { mkdirSync(base, { recursive: true }); dir = mkdtempSync(join(base, 'eudi-')); } catch { dir = mkdtempSync(join(tmpdir(), 'eudi-')); }
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '825',
      '-subj', '/CN=praetor.localhost', '-addext', 'subjectAltName=DNS:praetor.localhost'], { stdio: 'ignore' });
    return {
      EUDI_VERIFIER_KEY: readFileSync(join(dir, 'k.pem')).toString('base64'),
      EUDI_VERIFIER_CERT: readFileSync(join(dir, 'c.pem')).toString('base64'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function plannedNames(): string[] {
  return [...KEY_SETS.flatMap((s) => WALLET_ROLES.map((r) => `${s}_${r}`)), ...SHARED.flatMap((g) => g.names)];
}

const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

export function fillEnv(text: string): { text: string; added: string[] } {
  const env = parseEnv(text);
  const missing = (n: string) => !env[n];
  const values: Record<string, string> = {};
  for (const s of KEY_SETS) for (const r of WALLET_ROLES) if (missing(`${s}_${r}`)) values[`${s}_${r}`] = generatePrivateKey();
  // A multi-value generator (a key pair) runs only when every member is missing, so a pair is never split.
  for (const g of SHARED) if (g.names.every(missing)) Object.assign(values, g.make());
  const added = Object.keys(values);
  if (added.length === 0) return { text, added };

  // Empty placeholders are filled where they stand; the rest goes into one appended block.
  const placed = new Set<string>();
  const lines = text.split('\n').map((line) => {
    const m = LINE.exec(line);
    if (m && m[2] === '' && values[m[1]!] !== undefined) { placed.add(m[1]!); return `${m[1]}=${values[m[1]!]}`; }
    return line;
  });
  let out = lines.join('\n');
  const rest = added.filter((n) => !placed.has(n));
  if (rest.length > 0) {
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
    out += `\n# Generated by scripts/keys/generate.ts on ${new Date().toISOString()}. TESTNET ONLY. Never commit, print or paste.\n`;
    out += rest.map((n) => `${n}=${values[n]}`).join('\n') + '\n';
  }
  return { text: out, added };
}

export function publicAddresses(env: Record<string, string>): { name: string; address: string }[] {
  return KEY_SETS.flatMap((s) => WALLET_ROLES.map((r) => `${s}_${r}`))
    .filter((n) => env[n])
    .map((name) => ({ name, address: privateKeyToAccount(env[name] as `0x${string}`).address }));
}
