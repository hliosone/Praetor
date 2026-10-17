import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { encodeErrorResult } from 'viem';
import { loadDeployments, baseNow, waitSynced, decodeRefusal, abis, buildAbisSource, CONTRACTS } from '../src/index.js';

const sample: Record<string, unknown> = {
  env: 'fork', chainId: 84532, domainName: 'Praetor-local', deployBlock: 1, forkBlock: 48226000,
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032', safe7579Adapter: '0x7579EE8307284F293B1927136486880611F20002',
  safe7579Launchpad: '0x7579011aB74c46090561ea277Ba79D510c6C00ff', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  bank: '0x' + '01'.repeat(20), regulator: '0x' + '02'.repeat(20), operator: '0x' + '03'.repeat(20),
  ...Object.fromEntries(['noOwner', 'priceOracle', 'mandateHook', 'passkeyValidator', 'agentKeyValidator', 'standingOrders',
    'identityRegistry', 'compliance', 'txau', 'txag', 'treasuryDesk', 'payoutRail', 'refusalLog', 'anchor', 'paymaster',
    'wecrossInbox'].map((k, i) => [k, '0x' + (i + 16).toString(16).padStart(2, '0').repeat(20)])),
};

describe('deployments loader', () => {
  it('loads and validates a deployment file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dep-'));
    writeFileSync(join(dir, 'fork.json'), JSON.stringify(sample));
    const d = loadDeployments(join(dir, 'fork.json'));
    expect(d.chainId).toBe(84532);
    expect(d.mandateHook).toMatch(/^0x/);
  });

  it('refuses a file missing a contract or on another chain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dep-'));
    const missing = { ...sample };
    delete missing.mandateHook;
    writeFileSync(join(dir, 'a.json'), JSON.stringify(missing));
    expect(() => loadDeployments(join(dir, 'a.json'))).toThrow(/mandateHook/);
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ ...sample, chainId: 1 }));
    expect(() => loadDeployments(join(dir, 'b.json'))).toThrow(/chainId/);
  });
});

describe('Base clock and lag (spec 02: services derive time from the latest Base block)', () => {
  it('baseNow is the latest block timestamp, never the wall clock', async () => {
    const client = { getBlock: async () => ({ timestamp: 1_900_000_000n }) };
    expect(await baseNow(client as never)).toBe(1_900_000_000n);
  });

  it('waitSynced polls until the node has the receipt block', async () => {
    let n = 5n;
    const client = { getBlockNumber: async () => n++ };
    await waitSynced(client as never, 8n, { intervalMs: 1, attempts: 10 });
    expect(n).toBe(9n);
    const stuck = { getBlockNumber: async () => 1n };
    await expect(waitSynced(stuck as never, 8n, { intervalMs: 1, attempts: 3 })).rejects.toThrow(/block 8/);
  });
});

describe('refusals', () => {
  it('decodes MandateRefused into the reason name and callHash', () => {
    const data = encodeErrorResult({ abi: abis.MandateHook, errorName: 'MandateRefused', args: [7, `0x${'ab'.repeat(32)}`] });
    expect(decodeRefusal(data)).toEqual({ reason: 7, reasonName: 'UNKNOWN_PAYEE', callHash: `0x${'ab'.repeat(32)}` });
    expect(decodeRefusal('0x12345678')).toBeNull();
  });
});

describe('ABIs generated from Foundry (spec 05)', () => {
  it('has every Base contract with its key entry points and the libraries errors', () => {
    for (const c of CONTRACTS) expect(abis[c], c).toBeDefined();
    const names = (a: readonly { type: string; name?: string }[]) => a.map((x) => x.name);
    expect(names(abis.MandateHook)).toEqual(expect.arrayContaining(['check', 'checkBatch', 'preCheck', 'applyStatus', 'registerApproval', 'BadSignatures', 'BadSoter', 'MandateRefused']));
    expect(names(abis.PraetorPaymaster)).toContain('getHash');
    expect(names(abis.RefusalLog)).toEqual(expect.arrayContaining(['log', 'logBatch', 'Refused']));
  });

  it('is current with contracts/base/out (regenerate with pnpm --filter @praetor/chain abis)', () => {
    execFileSync('forge', ['build', '--root', '../../contracts/base', '-q'], { stdio: 'pipe' });
    const fresh = buildAbisSource('../../contracts/base/out');
    expect(readFileSync(new URL('../src/abis.generated.ts', import.meta.url), 'utf8')).toBe(fresh);
  }, 120_000);
});
