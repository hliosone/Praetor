// Which accounts the band check may wake (spec 05: "every active account"). Waking any other agent only produces a
// refusal or an approval request nobody asked for: old test accounts kept being woken on every price move.
import { Status } from '@praetor/protocol';

export type AccountState = {
  now: bigint;
  /** policyOf(account).validUntil: 0 when no policy was ever set. */
  policyValidUntil: bigint;
  kya: { kycLevel: number; validUntil: bigint };
  /** AgentKeyValidator.agentOf(account). */
  agent: { key: string; validUntil: bigint; revoked: boolean };
  /** statusOf(account).effective: the consortium's status. */
  effectiveStatus: number;
  paused: boolean;
  recoveryPending: boolean;
};

/** The hook's own conditions (SESSION_EXPIRED, KYA_INVALID, FROZEN, RESTRICTED) plus a usable agent key. */
export function wakeable(a: AccountState): boolean {
  if (a.policyValidUntil < a.now) return false;
  if (a.kya.kycLevel === 0 || a.kya.validUntil < a.now) return false;
  if (BigInt(a.agent.key) === 0n || a.agent.revoked || a.agent.validUntil < a.now) return false;
  return a.effectiveStatus === Status.ACTIVE && !a.paused && !a.recoveryPending;
}
