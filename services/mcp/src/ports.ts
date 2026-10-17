// Production ports of the tools: Base reads (free views), submission through agent-signer and the bundler, approval
// requests to the api, payee names from mcp's database.
import { erc20Abi, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import { MandateHookAbi, PriceOracleAbi, TreasuryDeskAbi, baseNow, type Deployment } from '@praetor/chain';
import { REASONS, TIERS, type Policy } from '@praetor/protocol';
import { signCaller } from '@praetor/protocol/caller-auth';
import { ENTRY_POINT, encodeExecute } from '@praetor/userop';
import type { SqlRunner } from '@praetor/db';
import type { ActivityItem, Call, Ports, Submission } from './tools.js';

const DECISION = parseAbiItem('event Decision(address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, uint256 valueUsd6)');
const REFUSED = parseAbiItem('event Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter)');
const UPDATED = parseAbiItem('event PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)');
const LOOKBACK = 20_000n;

export function chainReader(pub: PublicClient, d: Deployment): Ports['reader'] {
  const hook = { address: d.mandateHook, abi: MandateHookAbi } as const;
  // Never before the deployment: on a fork, blocks before the fork point are not served (and hold no Praetor logs).
  const from = async () => {
    const head = await pub.getBlockNumber();
    const back = head > LOOKBACK ? head - LOOKBACK : 0n;
    return back > BigInt(d.deployBlock) ? back : BigInt(d.deployBlock);
  };
  return {
    balances: async (account) => {
      const tokens = [d.usdc, d.txau, d.txag];
      const r = await Promise.all(tokens.map((t) => pub.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [account] })));
      return Object.fromEntries(tokens.map((t, i) => [t, r[i]!]));
    },
    price: async (token) => {
      const [price8, publishTime] = (await pub.readContract({ address: d.priceOracle, abi: PriceOracleAbi, functionName: 'getPrice', args: [token] })) as readonly [bigint, bigint];
      if (token.toLowerCase() === d.usdc.toLowerCase()) return { price8, publishTime, source: 0 };
      const logs = await pub.getLogs({ address: d.priceOracle, event: UPDATED, args: { token }, fromBlock: await from(), toBlock: 'latest' });
      return { price8, publishTime, source: Number(logs.at(-1)?.args.source ?? 0) };
    },
    policy: async (account) => {
      const p = (await pub.readContract({ ...hook, functionName: 'policyOf', args: [account] })) as unknown as Policy;
      return p.validUntil === 0n ? null : p;
    },
    status: async (account) => {
      const [effective, acc, global, hb] = (await pub.readContract({ ...hook, functionName: 'statusOf', args: [account] })) as readonly [number, number, number, bigint];
      return { effective, account: acc, global, heartbeatValidUntil: BigInt(hb) };
    },
    kya: async (account) => {
      const [agentKey, , riskProfile, , validUntil] = (await pub.readContract({ ...hook, functionName: 'kyaOf', args: [account] })) as readonly [Address, number, number, Hex, bigint];
      return { agentKey, riskProfile, validUntil: BigInt(validUntil) };
    },
    caps: async (account) => {
      const [, , riskProfile] = (await pub.readContract({ ...hook, functionName: 'kyaOf', args: [account] })) as readonly [Address, number, number, Hex, bigint];
      const [perTx, daily, monthly] = (await pub.readContract({ ...hook, functionName: 'capsOf', args: [riskProfile] })) as readonly [bigint, bigint, bigint];
      return { perTx, daily, monthly };
    },
    spent: async (account) => {
      const [day, month, count, rebalances] = (await pub.readContract({ ...hook, functionName: 'spentOf', args: [account] })) as readonly [bigint, bigint, bigint, bigint];
      return { day, month, count, rebalances };
    },
    check: async (account, calls) => {
      const [reasons, tiers, hashes] = (await pub.readContract({ ...hook, functionName: 'checkBatch', args: [account, calls.map((c) => ({ target: c.to, value: c.value, callData: c.data }))] })) as readonly [readonly number[], readonly number[], readonly Hex[]];
      return reasons.map((reason, i) => ({ reason, tier: tiers[i]!, callHash: hashes[i]! }));
    },
    quote: async (tokenIn, tokenOut, amountIn) => {
      const [out] = (await pub.readContract({ address: d.treasuryDesk, abi: TreasuryDeskAbi, functionName: 'quote', args: [tokenIn, tokenOut, amountIn] })) as readonly [bigint, bigint];
      return out;
    },
    activity: async (account, limit) => {
      const fromBlock = await from();
      const [decisions, refusals] = await Promise.all([
        pub.getLogs({ address: d.mandateHook, event: DECISION, args: { account }, fromBlock, toBlock: 'latest' }),
        pub.getLogs({ address: d.refusalLog, event: REFUSED, args: { account }, fromBlock, toBlock: 'latest' }),
      ]);
      const items: (ActivityItem & { block: bigint })[] = [
        ...decisions.map((l) => ({ kind: 'decision' as const, reason: REASONS[l.args.reason!] ?? '?', tier: TIERS[l.args.tier!] ?? '?', target: l.args.target!, txHash: l.transactionHash, valueUsd6: l.args.valueUsd6?.toString(), block: l.blockNumber })),
        ...refusals.map((l) => ({ kind: 'refusal' as const, reason: REASONS[l.args.reason!] ?? '?', tier: TIERS[l.args.tier!] ?? '?', target: l.args.target!, txHash: l.transactionHash, block: l.blockNumber })),
      ];
      return items.sort((a, b) => Number(b.block - a.block)).slice(0, limit).map(({ block: _b, ...i }) => i);
    },
    now: () => baseNow(pub),
  };
}

export type SubmitConfig = { bundlerUrl: string; bundlerToken: string; signerUrl: string; signerSecret: string; keyVersion?: number };

/** prepare (bundler) -> sign (agent-signer, mcp is its only sign-userop caller) -> send (bundler). */
export function submitter(c: SubmitConfig): Ports['submit'] {
  const bundler = async (path: string, body: unknown) => {
    const r = await fetch(`${c.bundlerUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.bundlerToken}` }, body: json(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status >= 300) throw new Error(`bundler ${path}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j as Record<string, any>;
  };
  return async (account: Address, calls: Call[]): Promise<Submission> => {
    const p = await bundler('/userop/prepare', { sender: account, callData: encodeExecute(calls), validator: 'agent' });
    const path = `/v1/agents/${account}/sign-userop`;
    const body = json({ userOp: p.userOp, chainId: 84532, entryPoint: ENTRY_POINT, keyVersion: c.keyVersion ?? 1 });
    const r = await fetch(`${c.signerUrl}${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...signCaller('mcp', c.signerSecret, 'POST', path, Buffer.from(body)) } });
    const sig = (await r.json().catch(() => ({}))) as { signature?: Hex; error?: string };
    if (!r.ok || !sig.signature) throw new Error(`agent-signer: ${r.status} ${sig.error ?? ''}`);
    const s = await bundler('/userop/send', { userOp: { ...p.userOp, signature: sig.signature } });
    return { userOpHash: s.userOpHash, txHash: s.txHash ?? null, success: s.success === true, reasons: (s.reasons ?? []).map(Number), refusalLogTx: s.refusalLogTx ?? null };
  };
}

/** Approval requests live in the api (M9); without it they are refused plainly. */
/** The agent's standing-order proposals, stored in the api as owner requests (F7 step 1). */
export function apiProposals(apiUrl: string | undefined, token: string | undefined): Ports['proposals'] {
  return {
    standingOrder: async (req) => {
      if (!apiUrl || !token) throw new Error('the owner request service is not available');
      const r = await fetch(`${apiUrl}/internal/standing-order-proposals`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: json(req) });
      if (!r.ok) throw new Error(`api standing-order proposal: ${r.status}`);
      return r.json() as Promise<{ id: string }>;
    },
  };
}

export function apiApprovals(apiUrl: string | undefined, token: string | undefined): Ports['approvals'] {
  const call = async (method: string, path: string, body?: unknown) => {
    if (!apiUrl || !token) throw new Error('the approval service is not available');
    const r = await fetch(`${apiUrl}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : json(body) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`api ${path}: ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  return {
    request: async (req) => (await call('POST', '/internal/approvals', req)) as { id: string },
    get: (account, id) => call('GET', `/internal/approvals/${encodeURIComponent(id)}?account=${account}`),
  };
}

export function dbLabels(r: SqlRunner): Ports['labels'] {
  return async (account) => {
    const rows = (await r.query('SELECT address, label FROM payee_labels WHERE account = ?', [account.toLowerCase()])) as { address: string; label: string }[];
    return Object.fromEntries(rows.map((x) => [x.address.toLowerCase(), x.label]));
  };
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
