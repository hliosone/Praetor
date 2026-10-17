// M0 link: the compose skeleton (caddy, mysql, anvil fork) is up and wired as spec 11 says.
import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ANVIL_URL, compose, rpc } from './lib/stack.js';

describe('anvil fork of Base Sepolia', () => {
  it('answers with chain id 84532', async () => {
    expect(BigInt(await rpc<string>(ANVIL_URL, 'eth_chainId'))).toBe(84532n);
  });

  it('exposes the RIP-7212 P-256 precompile at 0x100 (Q6)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const msg = Buffer.from('praetor p256 probe');
    const der = sign('sha256', msg, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const jwk = publicKey.export({ format: 'jwk' });
    const input = Buffer.concat([
      createHash('sha256').update(msg).digest(),
      der,
      Buffer.from(jwk.x!, 'base64url'),
      Buffer.from(jwk.y!, 'base64url'),
    ]);
    const out = await rpc<string>(ANVIL_URL, 'eth_call', [{ to: '0x0000000000000000000000000000000000000100', data: '0x' + input.toString('hex') }, 'latest']);
    expect(BigInt(out)).toBe(1n);
  });

  it('serves Circle USDC from the fork', async () => {
    const symbol = await rpc<string>(ANVIL_URL, 'eth_call', [{ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', data: '0x95d89b41' }, 'latest']);
    expect(Buffer.from(symbol.slice(130, 138), 'hex').toString()).toBe('USDC');
  });
});

describe('mysql', () => {
  it('has one database per service, each reachable with its own user', () => {
    const out = compose('exec', '-T', 'mysql', 'sh', '-c',
      'for s in api mcp bank regulator operator payout weid webase wecross bundler; do v=MYSQL_PASSWORD_$(echo $s | tr a-z A-Z); eval p=\\$$v; MYSQL_PWD="$p" mysql -u$s -h127.0.0.1 -N -e "SELECT DATABASE()" $s; done');
    expect(out.trim().split('\n')).toEqual(['api', 'mcp', 'bank', 'regulator', 'operator', 'payout', 'weid', 'webase', 'wecross', 'bundler']);
  });

  it('refuses a service user on another service database', () => {
    expect(() => compose('exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_PASSWORD_API" mysql -uapi -h127.0.0.1 -e "SELECT 1" bank')).toThrow();
  });
});

describe('caddy', () => {
  it('serves https://praetor.localhost with its internal CA', () => {
    const body = execFileSync('curl', ['-sk', '--resolve', 'praetor.localhost:443:127.0.0.1', 'https://praetor.localhost/health'], { encoding: 'utf8' });
    expect(body).toBe('ok');
  });
});
