// Points one environment of miniprogram/config.js at an api origin: `node scripts/set-api-base.mjs` takes the tunnel
// URL that `make tunnel` writes to .run/tunnel-url for develop; `node scripts/set-api-base.mjs release https://host`
// sets another environment.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENVS = ['develop', 'trial', 'release'];

export function rewriteApiBase(source, env, url) {
  if (!ENVS.includes(env)) throw new Error(`unknown environment ${env} (develop, trial or release)`);
  if (!/^https:\/\//.test(url)) throw new Error('the api base must be https (WeChat refuses plain http outside debug mode)');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url)) throw new Error('the api base must be an origin: https://host, no path');
  const line = new RegExp(`^(  ${env}: ')[^']*(',)$`, 'm');
  if (!line.test(source)) throw new Error(`no ${env} line in config.js`);
  return source.replace(line, `$1${url}$2`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('../miniprogram/config.js', import.meta.url);
  const env = process.argv[2] ?? 'develop';
  const url = (process.argv[3] ?? readFileSync(new URL('../../../.run/tunnel-url', import.meta.url), 'utf8')).trim().replace(/\/$/, '');
  writeFileSync(file, rewriteApiBase(readFileSync(file, 'utf8'), env, url));
  console.log(`${env} -> ${url}`);
}
