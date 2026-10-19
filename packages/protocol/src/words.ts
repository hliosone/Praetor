// The owner's words for the reasons a human approval lifts: the web approval page and the approval notification show
// every reason of a request (its reason field lists their names, comma-separated, the hook's own first).
import type { ReasonName } from './constants.js';

const WORDS: Partial<Record<ReasonName, string>> = {
  RESTRICTED: 'the agent is paused or restricted',
  STALE_STATUS: 'the consortium heartbeat is missing',
  UNKNOWN_PAYEE: 'the payee is not in your mandate',
  OVER_AUTO_CAP: 'above the amount the agent may pay alone',
  BUDGET_EXCEEDED: 'over your daily or monthly budget',
  COUNT_EXCEEDED: 'over the number of payments allowed today',
  BAND_BREACH: 'it would leave an asset outside its band',
  BUFFER_BREACH: 'USDC would fall below your cash buffer',
  TIER2_REQUIRED: 'it needs your approval',
  REBALANCE_LIMIT: 'over the rebalancing limit (per day or per trade)',
};

/** "UNKNOWN_PAYEE,OVER_AUTO_CAP" -> one phrase per reason, in order; a name without words stays as it is. */
export function reasonWords(list: string): string[] {
  return list.split(',').map((r) => r.trim()).filter(Boolean).map((r) => WORDS[r as ReasonName] ?? r);
}
