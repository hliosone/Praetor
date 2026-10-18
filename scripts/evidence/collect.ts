// docs/EVIDENCE.md (spec 12, M16): every transaction of the evidence run, executed and refused, per flow. Base
// transactions are read back from the chain (the events of Praetor's contracts touching the flow's accounts, in the
// flow's block range) with BaseScan links; FISCO transactions are read from the consortium chain's blocks in the
// flow's range (contract and method decoded). Input: .run/evidence/<env>.json written by live-run.ts.
// Usage: pnpm exec tsx scripts/evidence/collect.ts <env>   (env: base-sepolia on live; fork works for a dry run)
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, decodeEventLog, decodeFunctionData, http, type Abi, type Address, type Hex, type Log } from 'viem';
import { baseSepolia } from 'viem/chains';
import { anchorEventsAbi, mandateHookEventsAbi, payoutRailEventsAbi, refusalLogEventsAbi, standingOrdersEventsAbi, treasuryDeskEventsAbi, REASONS } from '@praetor/protocol';
import { fiscoAbis } from '@praetor/fisco-client';
import { boundedGetLogs, loadDeployments } from '@praetor/chain';

export type Flow = { id: string; title: string; accounts: Address[]; base: [string, string]; fisco: [string, string]; notes?: string[] };
export type Run = { env: string; startedAt: string; flows: Flow[] };

const root = new URL('../../', import.meta.url);
const SCAN = 'https://sepolia.basescan.org';

/** A flow note (often the model's own words) as one Markdown line, without the em dashes the repository refuses. */
export function noteLine(n: string): string {
  return n.replace(/\s*\u2014\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

/** The Base events of one flow, grouped by transaction: the events touching its accounts, plus anchors. */
export function baseRows(logs: (Log & { decoded: { eventName: string; args: Record<string, unknown> } })[], accounts: Address[]) {
  const mine = new Set(accounts.map((a) => a.toLowerCase()));
  const rows = new Map<string, string[]>();
  for (const l of logs) {
    const a = l.decoded.args as { account?: string };
    if (l.decoded.eventName !== 'Anchored' && !(a.account && mine.has(a.account.toLowerCase()))) continue;
    const what = l.decoded.eventName === 'Decision' || l.decoded.eventName === 'Refused'
      ? `${l.decoded.eventName} ${REASONS[Number((l.decoded.args as { reason: number }).reason)] ?? '?'}` : l.decoded.eventName;
    rows.set(l.transactionHash!, [...(rows.get(l.transactionHash!) ?? []), what]);
  }
  return [...rows].map(([tx, events]) => ({ tx, events }));
}

async function main(envName: string) {
  const run = JSON.parse(readFileSync(new URL(`.run/evidence/${envName}.json`, root), 'utf8')) as Run;
  const d = loadDeployments(new URL(`infra/deployments/${envName}.json`, root).pathname);
  const fiscoFile = JSON.parse(readFileSync(new URL(`infra/deployments/fisco-${envName === 'base-sepolia' ? 'live' : 'local'}.json`, root), 'utf8')) as Record<string, string>;
  const live = envName === 'base-sepolia';
  const base = createPublicClient({ chain: baseSepolia, transport: http(live ? (process.env.BASE_LIVE_RPC_URL ?? 'https://base-sepolia-rpc.publicnode.com') : (process.env.ANVIL_URL ?? 'http://127.0.0.1:18545')) });
  const getLogs = boundedGetLogs(base);
  const fisco = createPublicClient({ transport: http(process.env.FISCO_RPC_URL_HOST ?? 'http://10.88.1.10:8545') });
  const sources: [Address, Abi][] = [
    [d.mandateHook, mandateHookEventsAbi], [d.refusalLog, refusalLogEventsAbi], [d.standingOrders, standingOrdersEventsAbi],
    [d.payoutRail, payoutRailEventsAbi], [d.treasuryDesk, treasuryDeskEventsAbi], [d.anchor, anchorEventsAbi],
  ];
  const fiscoNames = new Map(Object.entries(fiscoFile).filter(([, v]) => /^0x[0-9a-fA-F]{40}$/.test(v)).map(([k, v]) => [v.toLowerCase(), k]));
  const fiscoAbiOf = (name: string) => (fiscoAbis as Record<string, Abi>)[name.charAt(0).toUpperCase() + name.slice(1)];

  const out: string[] = [
    '# Evidence', '',
    `Every transaction of the evidence run on **${live ? 'Base Sepolia (live)' : 'the local fork'}**, executed and refused, per flow. Written by \`scripts/evidence/collect.ts\` from the chains themselves; do not edit by hand.`, '',
    `Run started ${run.startedAt}. Contracts: MandateHook [\`${d.mandateHook}\`](${SCAN}/address/${d.mandateHook}), RefusalLog [\`${d.refusalLog}\`](${SCAN}/address/${d.refusalLog}), Anchor [\`${d.anchor}\`](${SCAN}/address/${d.anchor}). FISCO AuditLog \`${fiscoFile.auditLog}\` (chain ${fiscoFile.chainId}).`, '',
  ];
  for (const f of run.flows) {
    const logs: (Log & { decoded: { eventName: string; args: Record<string, unknown> } })[] = [];
    for (const [address, abi] of sources) {
      for (const l of await getLogs({ address, fromBlock: BigInt(f.base[0]), toBlock: BigInt(f.base[1]) })) {
        try { logs.push({ ...l, decoded: decodeEventLog({ abi, data: l.data, topics: l.topics }) as never }); } catch { /* not one of ours */ }
      }
    }
    logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
    const rows = baseRows(logs, f.accounts);
    out.push(`## ${f.id} · ${f.title}`, '');
    for (const n of f.notes ?? []) out.push(`- ${noteLine(n)}`);
    if (f.notes?.length) out.push('');
    out.push('| Base transaction | Events |', '|---|---|');
    for (const r of rows) out.push(`| [\`${r.tx.slice(0, 18)}...\`](${SCAN}/tx/${r.tx}) | ${r.events.join(', ')} |`);
    if (rows.length === 0) out.push('| (none) | |');
    const ftx: { tx: string; block: bigint; what: string }[] = [];
    for (let b = BigInt(f.fisco[0]); b <= BigInt(f.fisco[1]); b++) {
      const block = await fisco.getBlock({ blockNumber: b, includeTransactions: true }).catch(() => null);
      for (const t of (block?.transactions ?? []) as { hash: Hex; to: Address | null; input: Hex }[]) {
        const name = t.to ? fiscoNames.get(t.to.toLowerCase()) : undefined;
        if (!name) continue;
        let method = t.input.slice(0, 10);
        try { method = decodeFunctionData({ abi: fiscoAbiOf(name)!, data: t.input }).functionName; } catch { /* selector only */ }
        ftx.push({ tx: t.hash, block: b, what: `${name}.${method}` });
      }
    }
    out.push('', '| FISCO transaction | Block | Call |', '|---|---|---|');
    for (const t of ftx) out.push(`| \`${t.tx}\` | ${t.block} | ${t.what} |`);
    if (ftx.length === 0) out.push('| (none) | | |');
    out.push('');
  }
  writeFileSync(new URL('docs/EVIDENCE.md', root), `${out.join('\n')}\n`);
  console.log(`docs/EVIDENCE.md: ${run.flows.length} flows`);
}

if (process.argv[1]?.endsWith('collect.ts')) await main(process.argv[2] ?? 'base-sepolia');
