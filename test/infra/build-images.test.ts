// Images on the server are built there (DEPLOY.md section 9): scripts/deploy/build-images.sh builds every image of
// the production stack ahead of make up, with the compose command make up itself uses. Run here against a stub docker.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('scripts/deploy/build-images.sh', () => {
  it('builds the production profiles with make up\'s compose command (prod file, live env), pulls caddy and mysql, starts nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-images-'));
    const log = join(dir, 'calls.log');
    mkdirSync(join(dir, 'bin'));
    // docker: records the call; `image inspect` says the FISCO image exists, so make fisco-image builds nothing.
    writeFileSync(join(dir, 'bin', 'docker'), `#!/bin/bash\necho "docker $*" >> "${log}"\nexit 0\n`);
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    const r = spawnSync('bash', [join(root, 'scripts/deploy/build-images.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    expect(r.stderr).not.toMatch(/error/i);
    expect(r.status).toBe(0);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const composeCalls = calls.filter((c) => c.startsWith('docker compose'));
    expect(composeCalls.map((c) => c.split(' ').at(-1) === 'build' ? 'build' : c.split(' ').slice(-3).join(' '))).toEqual(['pull caddy mysql', 'build']);
    for (const c of composeCalls) {
      expect(c).toMatch(/^docker compose -f infra\/compose\.yml -f infra\/compose\.prod\.yml --env-file infra\/\.env\.example /);
      expect(c).toContain('--env-file infra/live.env');
      expect(c).toContain('--profile core --profile chain --profile mocks --profile agent --profile wecross');
      // The TEEs run on Phala in prod and anvil only on the fork.
      expect(c).not.toMatch(/--profile (tee-sim|dev)\b/);
    }
    expect(calls.some((c) => / up( |$)/.test(c))).toBe(false);
    expect(calls).toContain('docker image inspect praetor/fisco-bcos:3.17.1');
  });
});
