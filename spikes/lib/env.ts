// Reads the repo .env without exporting it to child processes or printing it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv(): Record<string, string> {
  const text = readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}
