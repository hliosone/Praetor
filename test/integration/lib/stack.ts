import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const ANVIL_URL = process.env.ANVIL_URL ?? 'http://127.0.0.1:18545';

// docker compose with the same env files as the Makefile, so tests see the stack `make up` started.
export function compose(...args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-f', 'infra/compose.yml', '--env-file', 'infra/.env.example', '--env-file', '.env', ...args],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}
