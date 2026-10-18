// The audit writer's sources: Base events of spec 02 (every Praetor contract that emits them) and FISCO decisions
// (BaseOutbox Enqueued, one per Ready). Each poll reads from its cursor to the head, in bounded windows (FISCO
// scans at most 10 blocks per getLogs, Q23; public Base RPCs refuse wide ranges, D98), and returns the events in chain
// order.
import { parseAbiItem, type Abi, type AbiEvent, type Address, type Hex, type PublicClient } from 'viem';
import { boundedGetLogs, logsMaxRange, type Deployment } from '@praetor/chain';
import { getLogsChunked } from '@praetor/fisco-client';
import {
  anchorEventsAbi, mandateHookEventsAbi, payoutRailEventsAbi, refusalLogEventsAbi, standingOrdersEventsAbi, treasuryDeskEventsAbi,
} from '@praetor/protocol';
import { fromBaseLog, fromOutbox, type SourceEvent } from './audit.js';

const BASE_EVENTS = [mandateHookEventsAbi, refusalLogEventsAbi, standingOrdersEventsAbi, payoutRailEventsAbi, treasuryDeskEventsAbi, anchorEventsAbi]
  .flatMap((abi) => (abi as Abi).filter((x): x is AbiEvent => x.type === 'event'));
const ENQUEUED = parseAbiItem('event Enqueued(uint256 indexed id, uint8 indexed kind, address indexed board, uint256 proposalId)');
const PAYOUT_OF = parseAbiItem('function payoutOf(uint256 id) view returns ((address account, address partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef, bool withdrawn, uint8 state))');

const blockTimes = async (pub: PublicClient, blocks: bigint[]) => {
  const out = new Map<bigint, number>();
  for (const b of [...new Set(blocks)]) out.set(b, Number((await pub.getBlock({ blockNumber: b })).timestamp) * 1000);
  return out;
};

export async function baseEvents(pub: PublicClient, d: Deployment, fromBlock: bigint, toBlock: bigint, maxRange = logsMaxRange()): Promise<SourceEvent[]> {
  const address = [d.mandateHook, d.refusalLog, d.standingOrders, d.payoutRail, d.treasuryDesk, d.anchor] as Address[];
  const logs = await boundedGetLogs(pub, maxRange)({ address, events: BASE_EVENTS, fromBlock, toBlock, strict: false });
  logs.sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex! - y.logIndex! : x.blockNumber! < y.blockNumber! ? -1 : 1));
  const times = await blockTimes(pub, logs.map((l) => l.blockNumber!));
  const out: SourceEvent[] = [];
  for (const l of logs) {
    const args = { ...(l.args as Record<string, unknown>) };
    // Settled and failed payouts name only the payout id: the account comes from the rail.
    if (l.eventName === 'PayoutSettled' || l.eventName === 'PayoutFailed') {
      args.account = (await pub.readContract({ address: d.payoutRail, abi: [PAYOUT_OF], functionName: 'payoutOf', args: [args.id as bigint] })).account;
    }
    const e = fromBaseLog({ eventName: l.eventName!, args, transactionHash: l.transactionHash!, logIndex: l.logIndex! }, times.get(l.blockNumber!)!);
    if (e) out.push(e);
  }
  return out;
}

export async function fiscoEvents(pub: PublicClient, outbox: Address, fromBlock: bigint, toBlock: bigint): Promise<SourceEvent[]> {
  const logs = await getLogsChunked(pub, { address: outbox, event: ENQUEUED, fromBlock, toBlock });
  const times = await blockTimes(pub, logs.map((l) => l.blockNumber!));
  return logs.flatMap((l) => {
    const a = l.args as { id: bigint; kind: number; board: Address; proposalId: bigint };
    const e = fromOutbox(a, l.transactionHash as Hex, l.logIndex!, times.get(l.blockNumber!)!);
    return e ? [e] : [];
  });
}
