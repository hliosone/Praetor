import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseAbiItem } from 'viem';
import { logWindows, getLogsChunked, msToSeconds, LEGACY_TX, fiscoChain, KIND_NAMES, buildFiscoAbisSource, fiscoAbis, FISCO_CONTRACTS } from '../src/index.js';

describe('FISCO quirks (spec 04, V2)', () => {
  it('splits a log range into windows of at most 10 blocks inclusive', () => {
    expect(logWindows(0n, 23n)).toEqual([[0n, 9n], [10n, 19n], [20n, 23n]]);
    expect(logWindows(5n, 5n)).toEqual([[5n, 5n]]);
    expect(logWindows(6n, 5n)).toEqual([]);
  });

  it('queries every window with address and event topics', async () => {
    const calls: { fromBlock: bigint; toBlock: bigint; address: string }[] = [];
    const client = { getLogs: async (p: { fromBlock: bigint; toBlock: bigint; address: string }) => { calls.push(p); return [{ blockNumber: p.fromBlock }]; } };
    const event = parseAbiItem('event Ready(uint8 indexed kind, uint256 indexed id, bytes payload, bytes[] sigs)');
    const logs = await getLogsChunked(client as never, { address: '0x0000000000000000000000000000000000000001', event, fromBlock: 0n, toBlock: 23n });
    expect(logs).toHaveLength(3);
    expect(calls.map((c) => [c.fromBlock, c.toBlock])).toEqual([[0n, 9n], [10n, 19n], [20n, 23n]]);
    expect(calls.every((c) => c.address === '0x0000000000000000000000000000000000000001')).toBe(true);
  });

  it('converts FISCO millisecond timestamps to the seconds attestations carry', () => {
    expect(msToSeconds(1_800_000_000_999n)).toBe(1_800_000_000n);
  });

  it('sends legacy transactions with gas price 0 on chain 20200', () => {
    expect(LEGACY_TX).toMatchObject({ type: 'legacy', gasPrice: 0n });
    expect(fiscoChain('http://x').id).toBe(20200);
  });

  it('names the message kinds like WeCrossInbox expects', () => {
    expect(KIND_NAMES).toEqual(['Status', 'Heartbeat', 'Caps', 'KYA', 'Asset', 'Sanctions', 'Jurisdiction', 'Attester', 'Anchor']);
  });
});

describe('FISCO ABIs', () => {
  it('has every consortium contract', () => {
    for (const c of FISCO_CONTRACTS) expect(fiscoAbis[c], c).toBeDefined();
    expect(fiscoAbis.AgentStatus.map((x) => (x as { name?: string }).name)).toEqual(expect.arrayContaining(['openStatus', 'sign', 'Ready', 'chainTimeSeconds']));
  });

  it('is current with contracts/fisco/out', () => {
    execFileSync('forge', ['build', '--root', '../../contracts/fisco', '-q'], { stdio: 'pipe' });
    expect(readFileSync(new URL('../src/abis.generated.ts', import.meta.url), 'utf8')).toBe(buildFiscoAbisSource('../../contracts/fisco/out'));
  }, 120_000);
});
