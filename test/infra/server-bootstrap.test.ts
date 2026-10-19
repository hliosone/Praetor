// The server bootstrap (spec 11 Phase C step 3, DEPLOY.md section 9). Its checks run here through the script's
// library mode (BOOTSTRAP_LIB=1 defines the functions and returns). The whole script runs twice in a throwaway
// ubuntu:24.04 container when BOOTSTRAP_CONTAINER_TEST=1 (minutes and network, so not in make test): the second run
// must find every step already done.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = `${root}scripts/deploy/server-bootstrap.sh`;
// ubuntu:24.04 (noble) as pulled on 2026-10-19; the server runs Google's image of the same release.
const UBUNTU_DIGEST = '68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac';
const lib = (code: string, env: Record<string, string> = {}) =>
  execFileSync('bash', ['-c', `BOOTSTRAP_LIB=1 source "$0"; ${code}`, script], { encoding: 'utf8', env: { ...process.env, ...env } });

describe('server-bootstrap.sh checks', () => {
  it('runs the deploy user\'s commands from that user\'s home (sudo from another home left corepack unable to read the cwd)', () => {
    // On the first VM: `sudo bash server-bootstrap.sh` from /home/sstelcher, then corepack as praetor: EACCES on ./package.json.
    expect(readFileSync(script, 'utf8')).toMatch(/^as_user\(\) \{ local h; h="\$\(getent passwd "\$DEPLOY_USER" \| cut -d: -f6\)"; runuser -u "\$DEPLOY_USER" -- env -C "\$h" HOME="\$h" "\$@"; \}$/m);
  });

  it('passes the routes of a GCP VM in the default VPC (asia-east2, 10.170.0.0/20)', () => {
    const gcp = [
      'default via 10.170.0.1 dev ens4 proto dhcp src 10.170.0.2 metric 100',
      '10.170.0.1 dev ens4 proto dhcp scope link src 10.170.0.2 metric 100',
      '169.254.169.254 via 10.170.0.1 dev ens4 proto dhcp src 10.170.0.2 metric 100',
    ].join('\n');
    expect(lib('stack_route_conflicts "$ROUTES"', { ROUTES: gcp })).toBe('');
  });

  it('flags a host route, gateway or address inside the stack networks (10.88/16, 10.89.0/24, 10.90.0/24)', () => {
    const bad = [
      '10.88.4.0/24 dev ens4 proto kernel scope link src 10.88.4.2',
      '10.90.0.5 via 10.170.0.1 dev ens4',
      'default via 10.89.0.1 dev ens5 proto dhcp src 10.89.0.3 metric 100',
      '10.0.0.0/8 via 10.170.0.1 dev ens4',
    ].join('\n');
    // The broader 10.0.0.0/8 loses to the stack's more specific bridges: no conflict.
    expect(lib('stack_route_conflicts "$ROUTES"', { ROUTES: bad })).toBe('10.88.4.0/24\n10.90.0.5\ndefault\n');
  });

  it('ignores the stack\'s own Docker bridges on a second run', () => {
    const own = [
      '10.88.0.0/16 dev br-0123456789ab proto kernel scope link src 10.88.0.1',
      '10.89.0.0/24 dev br-ba9876543210 proto kernel scope link src 10.89.0.1',
      '172.17.0.0/16 dev docker0 proto kernel scope link src 172.17.0.1 linkdown',
    ].join('\n');
    expect(lib('stack_route_conflicts "$ROUTES"', { ROUTES: own })).toBe('');
  });

  it('lowers the Docker MTU, default bridge and new networks, only on a host link below 1500 (GCP VPCs: 1460)', () => {
    const json = JSON.parse(lib('daemon_json 1460'));
    expect(json).toEqual({ mtu: 1460, 'default-network-opts': { bridge: { 'com.docker.network.driver.mtu': '1460' } } });
    expect(lib('daemon_json 1500')).toBe('');
  });

  it('requires compose 2.24 or later (compose.prod.yml uses !override, compose.refusals.yml !reset)', () => {
    expect(lib('version_ge 2.40.3 2.24.0 && echo yes || echo no')).toBe('yes\n');
    expect(lib('version_ge 5.0.1 2.24.0 && echo yes || echo no')).toBe('yes\n');
    expect(lib('version_ge 2.20.2 2.24.0 && echo yes || echo no')).toBe('no\n');
  });

  it.runIf(process.getuid?.() !== 0)('refuses to run as a normal user, before changing anything', () => {
    const r = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, BOOTSTRAP_LIB: '' } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/run as root/);
  });

  it.runIf(process.env.BOOTSTRAP_CONTAINER_TEST === '1')('sets up a fresh ubuntu:24.04 container, then finds everything done on a second run', async () => {
    // No systemd, no netfilter, no swap in a container: the script says which steps it skips. HOST_MTU=1460 makes it
    // write and validate the daemon.json a GCP VM gets.
    const run = 'bash /src/scripts/deploy/server-bootstrap.sh > /tmp/first.log 2>&1 || { cat /tmp/first.log; exit 1; }; '
      + 'bash /src/scripts/deploy/server-bootstrap.sh 2>&1';
    // Asynchronous: a synchronous child would block the worker for minutes.
    const { stdout: out } = await promisify(execFile)('docker', ['run', '--rm', '-e', 'HOST_MTU=1460', '-v', `${root}:/src:ro`, `ubuntu:24.04@sha256:${UBUNTU_DIGEST}`, 'bash', '-c', run], { encoding: 'utf8', timeout: 900_000 });
    expect(out).not.toMatch(/^bootstrap: done:/m);
    for (const step of ['packages', 'docker', 'daemon.json', 'user praetor', 'node', 'pnpm', 'cast', 'unattended-upgrades', 'firewall rules', 'app dir']) {
      expect(out, step).toMatch(new RegExp(`^bootstrap: ok: ${step}`, 'm'));
    }
  }, 900_000);
});
