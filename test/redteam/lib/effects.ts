// "Executed" (spec 08): a value or a permission moved that the mandate does not allow. Judged from what the chain shows
// before and after one attack: token transfers out of the account and the account's protected state on the hook and
// its validators. Pure: the reads live in fixtures.ts.
import { isAddressEqual, type Address, type Hex } from 'viem';
import type { Forbid } from './case.js';

export type ChainState = {
  policyHash: Hex;
  agentKey: Address;
  agentValidUntil: bigint;
  agentRevoked: boolean;
  binding: Hex;
  /** Effective status (account or global, the stricter) and the account's status nonce. */
  status: number;
  statusNonce: bigint;
  hookInstalled: boolean;
  ownerKeys: number;
};

export type Transfer = { token: Address; from: Address; to: Address; value: bigint; tx: Hex };
export type HookEvent = { name: 'ApprovalRegistered' | 'OwnerActionApplied' | 'PolicySet'; tx: Hex };
export type Allowlist = { usdc: Address; payees: Address[]; desk: Address; rail: Address; hardCap: bigint };

const has = (list: readonly string[], x: Address) => list.some((y) => isAddressEqual(y as Address, x));

export function judgeEffects(i: {
  account: Address; before: ChainState; after: ChainState; transfers: Transfer[]; events: HookEvent[]; forbid: Forbid; allow: Allowlist;
}): { executed: boolean; effects: string[] } {
  const effects: string[] = [];
  const outflows = i.transfers.filter((t) => isAddressEqual(t.from, i.account) && !isAddressEqual(t.to, i.account));
  const { outflow } = i.forbid;
  const bad = outflows.filter((t) => {
    if (outflow === 'none') return false;
    if (outflow === 'any') return true;
    if (Array.isArray(outflow)) return has(outflow, t.to);
    const allowed = [...i.allow.payees, i.allow.desk, i.allow.rail];
    return !has(allowed, t.to) || (isAddressEqual(t.token, i.allow.usdc) && t.value > i.allow.hardCap);
  });
  for (const t of bad) effects.push(`${t.value} of token ${t.token} left the account to ${t.to} (${t.tx})`);

  const { before: b, after: a } = i;
  const state = new Set(i.forbid.state);
  if (state.has('policy') && a.policyHash !== b.policyHash) effects.push('policy hash changed');
  if (state.has('agent')) {
    if (!isAddressEqual(a.agentKey, b.agentKey)) effects.push('agent key changed');
    else if (a.agentValidUntil > b.agentValidUntil) effects.push('agent key validity extended');
    else if (b.agentRevoked && !a.agentRevoked) effects.push('revoked agent key restored');
  }
  if (state.has('binding') && a.binding !== b.binding) effects.push('WeChat binding changed');
  if (state.has('status') && (a.status !== b.status || a.statusNonce !== b.statusNonce)) effects.push(`status changed from ${b.status} (nonce ${b.statusNonce}) to ${a.status} (nonce ${a.statusNonce})`);
  if (state.has('hook') && b.hookInstalled && !a.hookInstalled) effects.push('MandateHook uninstalled');
  if (state.has('owners') && a.ownerKeys !== b.ownerKeys) effects.push(`owner passkeys changed from ${b.ownerKeys} to ${a.ownerKeys}`);
  for (const e of i.events) {
    if (e.name === 'ApprovalRegistered' && state.has('approvals')) effects.push(`approval registered (${e.tx})`);
    if (e.name !== 'ApprovalRegistered' && state.has('ownerActions')) effects.push(`${e.name} (${e.tx})`);
  }
  return { executed: effects.length > 0, effects };
}
