import { describe, it, expect } from 'vitest';
import { custom, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, pad, parseAbiParameters, toHex, type AbiEvent, type Address, type Hex } from 'viem';
import { mandateHookEventsAbi, priceOracleEventsAbi } from '@praetor/protocol';
import { loadDeployments } from '@praetor/chain';
import { ENVS, SENDER_EVENTS, collect, guardedTransport, praetorContracts, type Budget, type ReadClient } from './i19-scan.js';

const d = loadDeployments(new URL('../../infra/deployments/base-sepolia-m16.json', import.meta.url).pathname);
const ACC = '0x7ff83549a3d36b93dfbcafa8feedcf68eeb9ad5f';
const HEAD = BigInt(d.deployBlock + 25_000);
const READ_ACTIONS = ['getChainId', 'getBlockNumber', 'getLogs', 'getTransaction'];

type Query = { address: string | string[]; event?: AbiEvent; args?: { sender?: string }; fromBlock: bigint; toBlock: bigint };

// A node with one Decision for ACC and one price update at the hook and oracle, one event of the account itself, and
// one user operation of the account at the EntryPoint (in the same transaction as the Decision). The client is a
// proxy that throws on anything but the four read actions: the collector cannot send, sign or change the node.
function fakeClient(budget?: Budget, chainId = 84532) {
  const calls: { action: string; p?: unknown }[] = [];
  const txDecision = keccak256('0x01');
  const txPrice = keccak256('0x02');
  const log = (address: string, transactionHash: Hex, logIndex: number, topics: Hex[], data: Hex = '0x') => ({ address: address as Address, transactionHash, logIndex, blockNumber: HEAD - 5n, topics, data });
  const track = (action: string, p?: unknown) => {
    calls.push({ action, p });
    if (budget) budget.calls++;
  };
  const impl: ReadClient = {
    getChainId: async () => (track('getChainId'), chainId),
    getBlockNumber: async () => (track('getBlockNumber'), HEAD),
    getTransaction: async (p) => (track('getTransaction', p), { hash: p.hash, to: d.entryPoint, input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ACC, 1n] }) }),
    getLogs: async (p) => {
      track('getLogs', p);
      const q = p as Query;
      // Public RPCs refuse an address array ("Request blocked" on publicnode): one address per query.
      if (typeof q.address !== 'string') throw new Error('Request blocked');
      if (q.toBlock !== HEAD) return [];
      const a = q.address.toLowerCase();
      if (a === d.mandateHook.toLowerCase()) {
        return [log(d.mandateHook, txDecision, 1, encodeEventTopics({ abi: mandateHookEventsAbi, eventName: 'Decision', args: { account: ACC, callHash: keccak256('0x03') } }) as Hex[],
          encodeAbiParameters(parseAbiParameters('uint8, uint8, address, uint256'), [0, 1, d.usdc, 125_000n]))];
      }
      if (a === d.priceOracle.toLowerCase()) {
        return [log(d.priceOracle, txPrice, 3, encodeEventTopics({ abi: priceOracleEventsAbi, eventName: 'PriceUpdated', args: { token: d.txau } }) as Hex[],
          encodeAbiParameters(parseAbiParameters('int256, uint64, uint8'), [416_533_000_000n, 1_792_300_000n, 1]))];
      }
      if (a === ACC && !q.event) return [log(ACC, txDecision, 0, [keccak256(toHex('ModuleInstalled(uint256,address)'))])];
      if (a === d.entryPoint.toLowerCase() && q.event?.name === 'UserOperationEvent' && q.args?.sender === ACC) return [log(d.entryPoint, txDecision, 2, [keccak256('0x04'), keccak256('0x05'), pad(ACC)])];
      return [];
    },
  };
  const client = new Proxy(impl, {
    get(t, k) {
      if (typeof k === 'string' && !READ_ACTIONS.includes(k)) throw new Error(`the scan asked for ${k}`);
      return t[k as keyof ReadClient];
    },
  });
  return { client, calls, txDecision, txPrice };
}

describe('guardedTransport', () => {
  it('refuses sending, signing and node-changing methods, lets reads through and counts them', async () => {
    const seen: string[] = [];
    const budget: Budget = { calls: 0, maxCalls: Infinity };
    const t = guardedTransport(custom({ request: async ({ method }) => { seen.push(method); return '0x1'; } }), budget)({});
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'eth_signTypedData_v4', 'personal_sign', 'wallet_sendCalls', 'anvil_setBalance', 'anvil_impersonateAccount', 'evm_mine', 'hardhat_setCode']) {
      await expect(t.request({ method } as never), method).rejects.toThrow(/read-only/);
    }
    for (const method of ['eth_chainId', 'eth_blockNumber', 'eth_getTransactionByHash']) await t.request({ method } as never);
    expect(seen).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_getTransactionByHash']);
    expect(budget.calls).toBe(3);
  });

  it('stops at its call budget', async () => {
    const budget: Budget = { calls: 0, maxCalls: 2 };
    const t = guardedTransport(custom({ request: async () => '0x1' }), budget)({});
    await t.request({ method: 'eth_chainId' } as never);
    await t.request({ method: 'eth_blockNumber' } as never);
    await expect(t.request({ method: 'eth_blockNumber' } as never)).rejects.toThrow(/budget/);
  });
});

describe('the environments, contracts and events scanned', () => {
  it('maps fork, live and m16 to their deployment files', () => {
    expect(Object.fromEntries(Object.entries(ENVS).map(([k, e]) => [k, e.file]))).toEqual({
      fork: 'infra/deployments/fork.json', live: 'infra/deployments/base-sepolia.json', m16: 'infra/deployments/base-sepolia-m16.json',
    });
  });

  it("queries Praetor's own contracts, never the shared EntryPoint, Safe7579, launchpad or USDC, nor the member addresses", () => {
    const c = praetorContracts(d).map((a) => a.toLowerCase());
    expect(c).toHaveLength(17);
    for (const k of ['mandateHook', 'refusalLog', 'identityRegistry', 'paymaster', 'wecrossInbox', 'wecrossProxy', 'txau', 'priceOracle'] as const) expect(c).toContain(d[k]!.toLowerCase());
    for (const k of ['entryPoint', 'safe7579Adapter', 'safe7579Launchpad', 'usdc', 'bank', 'regulator', 'operator'] as const) expect(c).not.toContain(d[k].toLowerCase());
  });

  it("reads every EntryPoint event that names the user operation's sender", () => {
    expect(SENDER_EVENTS.map((e) => e.name).sort()).toEqual(['AccountDeployed', 'PostOpRevertReason', 'UserOperationEvent', 'UserOperationPrefundTooLow', 'UserOperationRevertReason']);
  });
});

describe('collect', () => {
  it("reads the contracts' logs in bounded windows, then the accounts' own logs and their user operations, then each transaction once", async () => {
    const n = fakeClient();
    const r = await collect(n.client, d, { maxRange: 10_000n });
    expect(new Set(n.calls.map((c) => c.action))).toEqual(new Set(READ_ACTIONS));
    expect(r.from).toBe(BigInt(d.deployBlock));
    expect(r.to).toBe(HEAD);
    expect(r.accounts).toEqual([ACC]);
    const queries = n.calls.filter((c) => c.action === 'getLogs').map((c) => c.p as Query);
    // 25,001 blocks in windows of 10,000: three per query; one query per contract, the account, five EntryPoint events.
    expect(queries).toHaveLength(3 * (17 + 1 + 5));
    expect(queries.slice(0, 3).map((q) => [q.fromBlock, q.toBlock])).toEqual([[r.from, r.from + 9_999n], [r.from + 10_000n, r.from + 19_999n], [r.from + 20_000n, HEAD]]);
    expect(queries.filter((_, i) => i % 3 === 0).map((q) => q.address)).toEqual([...praetorContracts(d), ACC, ...SENDER_EVENTS.map(() => d.entryPoint)]);
    expect(queries.slice(-15).map((q) => q.args)).toEqual(Array(15).fill({ sender: ACC }));
    expect(r.counts).toEqual({ contractLogs: 2, accountLogs: 1, userOpLogs: 1 });
    expect(r.items.logs.map((l) => `${l.transactionHash}#${l.logIndex}`)).toEqual([`${n.txDecision}#0`, `${n.txDecision}#1`, `${n.txDecision}#2`, `${n.txPrice}#3`]);
    const txReads = n.calls.filter((c) => c.action === 'getTransaction').map((c) => (c.p as { hash: Hex }).hash);
    expect(txReads.sort()).toEqual([n.txDecision, n.txPrice].sort());
    expect(r.items.txs.map((t) => t.hash).sort()).toEqual([n.txDecision, n.txPrice].sort());
  });

  it('reads no transaction when they would not fit in the call budget, and says how many logs and transactions there are', async () => {
    const budget: Budget = { calls: 0, maxCalls: 2 + 3 * 23 + 1 };
    const n = fakeClient(budget);
    await expect(collect(n.client, d, { maxRange: 10_000n, budget })).rejects.toThrow(/4 logs \(contracts 2, accounts 1, EntryPoint 1\), 2 transactions to read, 1 calls left/);
    expect(n.calls.some((c) => c.action === 'getTransaction')).toBe(false);
  });

  it('refuses a node on another chain', async () => {
    const n = fakeClient(undefined, 8453);
    await expect(collect(n.client, d, { maxRange: 10_000n })).rejects.toThrow(/chain 8453/);
  });
});
