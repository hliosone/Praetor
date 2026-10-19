// The two TEEs on Phala Cloud (spec 11 Phase C step 5, DEPLOY.md sections 7 and 8): the CVM compose templates, and
// scripts/deploy/phala-deploy.sh run against stub docker and phala commands (nothing leaves the machine).
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
type Svc = { image: string; environment: Record<string, string>; volumes: string[]; ports: string[] };
const services = (svc: string) => (parse(read(`infra/phala/${svc}.compose.yml`)) as { services: Record<string, Svc> }).services;
const secretsOf = (svc: string) => [...read(`infra/phala/${svc}.compose.yml`).matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]).sort();

describe('infra/phala CVM compose templates', () => {
  const cases = [
    { svc: 'agent-signer', image: '__AGENT_SIGNER_IMAGE__', port: '3050:3050', secrets: ['SIGNER_HMAC_API', 'SIGNER_HMAC_BANK', 'SIGNER_HMAC_MCP'] },
    { svc: 'soter-attester', image: '__SOTER_ATTESTER_IMAGE__', port: '3060:3060', secrets: ['ATTESTER_HMAC_API', 'MP_APPID', 'MP_SECRET'] },
  ];
  for (const c of cases) {
    it(`${c.svc}: one service in prod with Phala attestations and the dstack socket, the image a digest placeholder`, () => {
      const all = services(c.svc);
      expect(Object.keys(all)).toEqual([c.svc]);
      const s = all[c.svc]!;
      expect(s.image).toBe(c.image);
      expect(s.environment).toMatchObject({ PRAETOR_ENV: 'prod', ATTESTATION_MODE: 'phala', DSTACK_ENDPOINT: '/var/run/dstack.sock' });
      expect(s.volumes).toEqual(['/var/run/dstack.sock:/var/run/dstack.sock']);
      expect(s.ports).toEqual([c.port]);
    });

    it(`${c.svc}: takes only the secrets of DEPLOY.md section 7 from encrypted env, every other value is measured`, () => {
      expect(secretsOf(c.svc)).toEqual(c.secrets);
      for (const name of c.secrets) expect(services(c.svc)[c.svc]!.environment[name]).toBe(`\${${name}}`);
    });
  }

  it('agent-signer: the public URL is measured (the signer signs agent cards for <PUBLIC_URL>/mcp only)', () => {
    expect(services('agent-signer')['agent-signer']!.environment.PUBLIC_URL).toBe('__PUBLIC_URL__');
  });

  it('soter-attester: the Base deployment baked into its image, and only the real WeChat API', () => {
    expect(services('soter-attester')['soter-attester']!.environment).toMatchObject({
      DEPLOYMENTS_FILE: '/app/infra/deployments/base-sepolia.json', WECHAT_API_BASE: 'https://api.weixin.qq.com', SOTER_FAKE_TENCENT: '0',
    });
  });
});

describe('scripts/deploy/phala-deploy.sh', () => {
  const script = join(root, 'scripts/deploy/phala-deploy.sh');
  const digest = (c: string) => `sha256:${c.repeat(64)}`;
  let dir: string;
  let out: string;
  let log: string;
  const env = (extra: Record<string, string> = {}) => ({
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir, OUT_DIR: out, ENV_FILE: join(dir, 'secrets.env'), STUB_LOG: log,
    PHALA_CLOUD_API_KEY: 'phak_test', ...extra,
  });
  const run = (args: string[], extra: Record<string, string> = {}) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: env(extra) });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const writeImages = () => writeFileSync(join(out, 'images.env'), [
    `AGENT_SIGNER_IMAGE=ghcr.io/example/praetor-agent-signer@${digest('a')}`,
    `SOTER_ATTESTER_IMAGE=ghcr.io/example/praetor-soter-attester@${digest('b')}`,
    'SOURCE_COMMIT=0123456',
  ].join('\n') + '\n');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'phala-deploy-'));
    out = join(dir, 'out');
    log = join(dir, 'calls.log');
    mkdirSync(join(dir, 'bin'));
    mkdirSync(out);
    // docker: records the call; a build writes the digest BuildKit would report into --metadata-file.
    writeFileSync(join(dir, 'bin', 'docker'), `#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do
  case "$1" in --metadata-file) shift; echo '{"containerimage.digest":"sha256:${'c'.repeat(64)}"}' > "$1" ;; esac
  shift
done
`);
    // phala: no CVM exists yet; a deploy keeps a copy of its encrypted env file to check the names it carries.
    writeFileSync(join(dir, 'bin', 'phala'), `#!/bin/bash
echo "phala $*" >> "$STUB_LOG"
[ "$1 $2" = "cvms get" ] && exit 1
if [ "$1" = deploy ]; then
  args=("$@"); for i in "\${!args[@]}"; do
    [ "\${args[$i]}" = -e ] && cp "\${args[$((i+1))]}" "$STUB_LOG.$(basename "\${args[$((i+1))]}")"
  done
  echo '{"app_id":"app_stub"}'
fi
exit 0
`);
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    chmodSync(join(dir, 'bin', 'phala'), 0o755);
    writeFileSync(join(dir, 'secrets.env'), [
      'SIGNER_HMAC_MCP=' + 'm'.repeat(64), 'SIGNER_HMAC_API=' + 'a'.repeat(64), 'SIGNER_HMAC_BANK=' + 'b'.repeat(64),
      'ATTESTER_HMAC_API=' + 't'.repeat(64), 'MP_APPID=wx0123456789abcdef', 'MP_SECRET=' + 's'.repeat(32), 'LIVE_DEPLOYER_KEY=0xnot-for-a-cvm',
    ].join('\n') + '\n');
  });

  it('refuses to do anything without PHALA_CONFIRM=1', () => {
    for (const mode of [[], ['build'], ['deploy']]) {
      const r = run(mode, { REGISTRY: 'ghcr.io/example', PUBLIC_URL: 'https://app.example.org' });
      expect(r.status, mode.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/PHALA_CONFIRM=1/);
    }
    expect(calls()).toEqual([]);
  });

  it('builds both images from the committed tree and pushes them, recording each by digest', () => {
    const r = run(['build'], { PHALA_CONFIRM: '1', REGISTRY: 'ghcr.io/example' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const builds = calls().filter((c) => c.startsWith('docker buildx build'));
    expect(builds).toHaveLength(2);
    const head = spawnSync('git', ['-C', root, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    for (const [i, svc] of ['agent-signer', 'soter-attester'].entries()) {
      expect(builds[i]).toContain(`--build-arg SERVICE=${svc}`);
      expect(builds[i]).toContain(`-t ghcr.io/example/praetor-${svc}:${head}`);
      expect(builds[i]).toMatch(/--platform linux\/amd64 .*--provenance=false .*--push/);
      expect(builds[i]).toContain(`-f ${out}/src/infra/node-service.Dockerfile`);
    }
    expect(readFileSync(join(out, 'images.env'), 'utf8')).toBe([
      `AGENT_SIGNER_IMAGE=ghcr.io/example/praetor-agent-signer@${digest('c')}`,
      `SOTER_ATTESTER_IMAGE=ghcr.io/example/praetor-soter-attester@${digest('c')}`,
      `SOURCE_COMMIT=${head}`,
    ].join('\n') + '\n');
    // The context is the commit, not the working tree: tracked files only.
    expect(existsSync(join(out, 'src', 'infra/node-service.Dockerfile'))).toBe(true);
    expect(existsSync(join(out, 'src', '.env'))).toBe(false);
  });

  it('deploys each CVM from its rendered compose with only its own secrets, then deletes the env files', () => {
    writeImages();
    const r = run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: 'https://app.example.org' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const deploys = calls().filter((c) => c.startsWith('phala deploy'));
    expect(deploys).toHaveLength(2);
    for (const [i, svc] of ['agent-signer', 'soter-attester'].entries()) {
      expect(deploys[i]).toContain(`-n praetor-${svc}`);
      expect(deploys[i]).toContain(`-c ${out}/${svc}.compose.yml`);
      expect(deploys[i]).toMatch(/-t tdx\.small/);
      expect(deploys[i]).toContain('--no-dev-os');
      expect(deploys[i]).toContain('--no-public-logs');
      expect(deploys[i]).toContain('--wait');
    }
    const names = (svc: string) => readFileSync(`${log}.${svc}.env`, 'utf8').trim().split('\n').map((l) => l.split('=')[0]).sort();
    expect(names('agent-signer')).toEqual(['SIGNER_HMAC_API', 'SIGNER_HMAC_BANK', 'SIGNER_HMAC_MCP']);
    expect(names('soter-attester')).toEqual(['ATTESTER_HMAC_API', 'MP_APPID', 'MP_SECRET']);
    const signer = readFileSync(join(out, 'agent-signer.compose.yml'), 'utf8');
    expect(signer).toContain(`image: ghcr.io/example/praetor-agent-signer@${digest('a')}`);
    expect(signer).toContain('PUBLIC_URL: https://app.example.org');
    expect(readFileSync(join(out, 'soter-attester.compose.yml'), 'utf8')).toContain(`image: ghcr.io/example/praetor-soter-attester@${digest('b')}`);
    for (const f of ['agent-signer.compose.yml', 'soter-attester.compose.yml']) expect(readFileSync(join(out, f), 'utf8')).not.toMatch(/__[A-Z_]+__/);
    expect(readdirSync(out).filter((f) => f.endsWith('.env') && f !== 'images.env')).toEqual([]);
    expect(r.stdout).not.toContain('m'.repeat(64));
  });

  it('adds the registry login to the encrypted env when the secrets file has one (a private package)', () => {
    writeImages();
    writeFileSync(join(dir, 'secrets.env'), readFileSync(join(dir, 'secrets.env'), 'utf8')
      + 'DSTACK_DOCKER_REGISTRY=ghcr.io\nDSTACK_DOCKER_USERNAME=example\nDSTACK_DOCKER_PASSWORD=ghp_readonly\n');
    expect(run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: 'https://app.example.org' }).status).toBe(0);
    const names = readFileSync(`${log}.agent-signer.env`, 'utf8').trim().split('\n').map((l) => l.split('=')[0]).sort();
    expect(names).toEqual(['DSTACK_DOCKER_PASSWORD', 'DSTACK_DOCKER_REGISTRY', 'DSTACK_DOCKER_USERNAME', 'SIGNER_HMAC_API', 'SIGNER_HMAC_BANK', 'SIGNER_HMAC_MCP']);
  });

  it('updates a CVM that already exists, by name, instead of creating a second one', () => {
    writeImages();
    writeFileSync(join(dir, 'bin', 'phala'), readFileSync(join(dir, 'bin', 'phala'), 'utf8').replace('[ "$1 $2" = "cvms get" ] && exit 1', '[ "$1 $2" = "cvms get" ] && exit 0'));
    expect(run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: 'https://app.example.org' }).status).toBe(0);
    const deploys = calls().filter((c) => c.startsWith('phala deploy'));
    expect(deploys[0]).toContain('--cvm-id praetor-agent-signer');
    expect(deploys[0]).not.toContain('-n praetor-agent-signer');
  });

  it('refuses an image without a digest, a public URL that is not https on a domain, and a missing secret', () => {
    writeImages();
    writeFileSync(join(out, 'images.env'), readFileSync(join(out, 'images.env'), 'utf8').replace(/@sha256:a+/, ':latest'));
    expect(run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: 'https://app.example.org' }).stderr).toMatch(/AGENT_SIGNER_IMAGE.*digest/);
    writeImages();
    for (const url of ['http://app.example.org', 'https://praetor.localhost', 'https://app.example.org/']) {
      expect(run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: url }).stderr, url).toMatch(/PUBLIC_URL/);
    }
    writeFileSync(join(dir, 'secrets.env'), readFileSync(join(dir, 'secrets.env'), 'utf8').replace(/^MP_SECRET=.*$/m, 'MP_SECRET='));
    expect(run(['deploy'], { PHALA_CONFIRM: '1', PUBLIC_URL: 'https://app.example.org' }).stderr).toMatch(/MP_SECRET/);
    expect(calls().filter((c) => c.startsWith('phala deploy'))).toEqual([]);
  });
});
