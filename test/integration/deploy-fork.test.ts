// M2 link: the deploy script on the anvil fork writes a deployment file whose contracts exist and are wired.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { ANVIL_URL, repoRoot } from './lib/stack.js';

const run = promisify(execFile);
type Deployment = Record<string, string | number>;
let d: Deployment;
const client = createPublicClient({ transport: http(ANVIL_URL) });

describe('deploy-contracts ENV=fork', () => {
  beforeAll(async () => {
    await run('bash', ['scripts/deploy/contracts.sh', 'fork'], { cwd: repoRoot, timeout: 600_000 });
    d = JSON.parse(readFileSync(`${repoRoot}infra/deployments/fork.json`, 'utf8')) as Deployment;
  }, 600_000);

  it('records chain, domain, fork block and every contract', () => {
    expect(d.chainId).toBe(84532);
    expect(d.domainName).toBe('Praetor-local');
    expect(d.forkBlock).toBe(48226000);
    for (const k of ['mandateHook', 'passkeyValidator', 'agentKeyValidator', 'standingOrders', 'priceOracle', 'treasuryDesk',
      'payoutRail', 'refusalLog', 'anchor', 'paymaster', 'wecrossInbox', 'txau', 'txag', 'identityRegistry', 'compliance', 'noOwner']) {
      expect(d[k], k).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('deployed code at every address', async () => {
    for (const k of ['mandateHook', 'paymaster', 'treasuryDesk', 'wecrossInbox']) {
      const code = await client.getCode({ address: d[k] as Address });
      expect(code?.length ?? 0, k).toBeGreaterThan(2);
    }
  });

  it('wires the hook to its modules, uses the local domain and funds the paymaster deposit', async () => {
    const hookAbi = parseAbi([
      'function modules() view returns ((address passkeyValidator,address agentKeyValidator,address standingOrders,address usdc,address desk,address payoutRail,address oracle))',
      'function domainName() view returns (string)',
    ]);
    const m = await client.readContract({ address: d.mandateHook as Address, abi: hookAbi, functionName: 'modules' });
    expect(m.usdc).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(m.desk.toLowerCase()).toBe(String(d.treasuryDesk).toLowerCase());
    expect(m.standingOrders.toLowerCase()).toBe(String(d.standingOrders).toLowerCase());
    expect(await client.readContract({ address: d.mandateHook as Address, abi: hookAbi, functionName: 'domainName' })).toBe('Praetor-local');
    const deposit = await client.readContract({
      address: d.entryPoint as Address, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf',
      args: [d.paymaster as Address],
    });
    expect(deposit).toBeGreaterThan(0n);
  });
});
