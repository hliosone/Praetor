// M10 link: payout-partner to the official Alipay+ MCP server (stdio, pinned in the partner image) to alipayplus-mock
// over HTTPS 443, with the request and response signatures of V7; and the partner's merchant directory the api reads.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { merchantRef } from '@praetor/protocol';

const probe = (code: string, minor: number) =>
  JSON.parse(execFileSync('docker', ['exec', 'praetor-payout-partner-1', 'node', '--import', 'tsx', 'src/probe.ts', code, String(minor)], { encoding: 'utf8', timeout: 120_000 }).trim().split('\n').at(-1)!);

describe('payout-partner', () => {
  it('pays a merchant through the official Alipay+ MCP server against the mock: SUCCESS with a PSP reference', () => {
    expect(probe('KOWLOON-LETTINGS', 100)).toMatchObject({ state: 'SUCCESS', settlementRef: expect.stringMatching(/^[0-9a-f]{32}$/) });
  }, 180_000);

  it('a declined payment comes back FAIL (the partner then fails the payout)', () => {
    expect(probe('DECLINE-TEST', 100)).toEqual({ state: 'FAIL' });
  }, 180_000);

  it('publishes its merchant directory with its own Base address', async () => {
    const r = await fetch('http://10.88.0.43:3310/merchants').then((x) => x.json());
    expect(r.partner).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.merchants).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'KOWLOON-LETTINGS', merchantRef: merchantRef('KOWLOON-LETTINGS') })]));
  });
});
