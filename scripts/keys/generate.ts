// Fills every missing key and secret of spec 01/11 into .env (mode 600), never touching existing values.
// Prints public addresses only. Usage: pnpm keys   (PRAETOR_ENV_FILE overrides the path, for tests)
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fillEnv, parseEnv, publicAddresses } from './lib.js';

const file = process.env.PRAETOR_ENV_FILE ?? fileURLToPath(new URL('../../.env', import.meta.url));
const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
const { text, added } = fillEnv(before);
if (added.length > 0) writeFileSync(file, text, { mode: 0o600 });
chmodSync(file, 0o600);

console.log(`${file}: ${added.length} value(s) added, existing values untouched, mode 600.`);
console.log('Public addresses (no secret is printed):');
for (const { name, address } of publicAddresses(parseEnv(text))) console.log(`  ${name.replace(/_KEY$/, '').padEnd(34)} ${address}`);
