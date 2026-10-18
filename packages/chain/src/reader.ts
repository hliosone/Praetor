// Reads of one account on Base (free views and bounded log scans), shared by mcp (the agent's tools) and the api (the
// owner's views): balances, prices with their source, policy, status, KYA, caps, spending, hook checks, desk quotes,
// and the recent decisions and refusals.
import { erc20Abi, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { REASONS, TIERS, type Policy } from '@praetor/protocol';
import { MandateHookAbi, PriceOracleAbi, TreasuryDeskAbi } from './abis.generated.js';
import { baseNow } from './base.js';
import { boundedGetLogs, logsMaxRange } from './logs.js';
import type { Deployment } from './deployments.js';

export type Call = { to: Address; value: bigint; data: Hex };
export type Verdict = { reason: number; tier: number; callHash: Hex };
export type PriceInfo = { price8: bigint; publishTime: bigint; source: number };
export type ActivityItem = { kind: 'decision' | 'refusal'; reason: string; tier: string; target: Address; txHash: Hex; valueUsd6?: string };

const DECISION = parseAbiItem('event Decision(address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, uint256 valueUsd6)');
const REFUSED = parseAbiItem('event Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter)');
const UPDATED = parseAbiItem('event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)');
const LOOKBACK = 20_000n;

export function accountReader(pub: PublicClient, d: Deployment, maxRange: bigint = logsMaxRange()) {
  const hook = { address: d.mandateHook, abi: MandateHookAbi } as const;
  const getLogs = boundedGetLogs(pub, maxRange);
  // Never before the deployment: on a fork, blocks before the fork point are not served (and hold no Praetor logs).
  const from = async () => {
    const head = await pub.getBlockNumber();
    const back = head > LOOKBACK ? head - LOOKBACK : 0n;
    return back > BigInt(d.deployBlock) ? back : BigInt(d.deployBlock);
  };
  return {
    balances: async (account: Address): Promise<Record<string, bigint>> => {
      const tokens = [d.usdc, d.txau, d.txag];
      const r = await Promise.all(tokens.map((t) => pub.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [account] })));
      return Object.fromEntries(tokens.map((t, i) => [t, r[i]!]));
    },
    price: async (token: Address): Promise<PriceInfo> => {
      const [price8, publishTime] = (await pub.readContract({ address: d.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [token] })) as readonly [bigint, bigint];
      if (token.toLowerCase() === d.usdc.toLowerCase()) return { price8, publishTime, source: 0 };
      const logs = await getLogs({ address: d.priceOracle, event: UPDATED, args: { token }, fromBlock: await from(), toBlock: 'latest' });
      return { price8, publishTime, source: Number(logs.at(-1)?.args.source ?? 0) };
    },
    policy: async (account: Address): Promise<Policy | null> => {
      const p = (await pub.readContract({ ...hook, functionName: 'policyOf', args: [account] })) as unknown as Policy;
      return p.validUntil === 0n ? null : p;
    },
    status: async (account: Address) => {
      const [effective, acc, global, hb] = (await pub.readContract({ ...hook, functionName: 'statusOf', args: [account] })) as readonly [number, number, number, bigint];
      return { effective, account: acc, global, heartbeatValidUntil: BigInt(hb) };
    },
    kya: async (account: Address) => {
      const [agentKey, kycLevel, riskProfile, jurisdiction, validUntil] = (await pub.readContract({ ...hook, functionName: 'kyaOf', args: [account] })) as readonly [Address, number, number, Hex, bigint];
      return { agentKey, kycLevel, riskProfile, jurisdiction, validUntil: BigInt(validUntil) };
    },
    caps: async (account: Address) => {
      const [, , riskProfile] = (await pub.readContract({ ...hook, functionName: 'kyaOf', args: [account] })) as readonly [Address, number, number, Hex, bigint];
      const [perTx, daily, monthly] = (await pub.readContract({ ...hook, functionName: 'capsOf', args: [riskProfile] })) as readonly [bigint, bigint, bigint];
      return { perTx, daily, monthly };
    },
    spent: async (account: Address) => {
      const [day, month, count, rebalances] = (await pub.readContract({ ...hook, functionName: 'spentOf', args: [account] })) as readonly [bigint, bigint, bigint, bigint];
      return { day, month, count, rebalances };
    },
    check: async (account: Address, calls: Call[]): Promise<Verdict[]> => {
      const [reasons, tiers, hashes] = (await pub.readContract({ ...hook, functionName: 'checkBatch', args: [account, calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))] })) as readonly [readonly number[], readonly number[], readonly Hex[]];
      return reasons.map((reason, i) => ({ reason, tier: tiers[i]!, callHash: hashes[i]! }));
    },
    quote: async (tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> => {
      const [out] = (await pub.readContract({ address: d.treasuryDesk, abi: TreasuryDeskAbi, functionName: 'quote', args: [tokenIn, tokenOut, amountIn] })) as readonly [bigint, bigint];
      return out;
    },
    activity: async (account: Address, limit: number): Promise<ActivityItem[]> => {
      const fromBlock = await from();
      const [decisions, refusals] = await Promise.all([
        getLogs({ address: d.mandateHook, event: DECISION, args: { account }, fromBlock, toBlock: 'latest' }),
        getLogs({ address: d.refusalLog, event: REFUSED, args: { account }, fromBlock, toBlock: 'latest' }),
      ]);
      const items: (ActivityItem & { block: bigint })[] = [
        ...decisions.map((l) => ({ kind: 'decision' as const, reason: REASONS[l.args.reason!] ?? '?', tier: TIERS[l.args.tier!] ?? '?', target: l.args.target!, txHash: l.transactionHash, valueUsd6: l.args.valueUsd6?.toString(), block: l.blockNumber })),
        ...refusals.map((l) => ({ kind: 'refusal' as const, reason: REASONS[l.args.reason!] ?? '?', tier: TIERS[l.args.tier!] ?? '?', target: l.args.target!, txHash: l.transactionHash, block: l.blockNumber })),
      ];
      return items.sort((a, b) => Number(b.block - a.block)).slice(0, limit).map(({ block: _b, ...i }) => i);
    },
    now: (): Promise<bigint> => baseNow(pub),
  };
}

export type AccountReader = ReturnType<typeof accountReader>;
