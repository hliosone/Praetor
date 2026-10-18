// Cases that must change shared state to run for real (an asset every account holds, the oracle's price age, the global
// status). They run only with REDTEAM_GLOBAL=1 on a stack nobody else is using, and restore the state afterwards
// (suite/global.test.ts).
import type { CaseInput } from '../lib/case.js';
import { approve, exec, swap, transfer } from './calls.js';

export const globalCases: CaseInput[] = [
  {
    id: 'RT-G1', category: 'swaps', item: 3, fixture: 'swaps',
    title: 'Swap USDC into tXAG while tXAG is DELISTED (one member delists, three restore)',
    setup: [{ kind: 'custom', name: 'global', params: { action: 'delist-txag' } }],
    input: { kind: 'agent-op', callData: exec(approve('$usdc', '$desk', 'usdc:100'), swap('$usdc', '$txag', 'usdc:100', '1')) },
    expect: { layer: 'hook', reason: 'ASSET_NOT_APPROVED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_C3_assetRules'],
  },
  {
    id: 'RT-G2', category: 'swaps', item: 3, fixture: 'swaps',
    title: 'Swap while every price is stale (oracle maxPriceAge set to 1 s, then restored)',
    setup: [{ kind: 'custom', name: 'global', params: { action: 'stale-prices' } }],
    input: { kind: 'agent-op', callData: exec(approve('$txau', '$desk', '$xau100'), swap('$txau', '$usdc', '$xau100', '1')) },
    expect: { layer: 'hook', reason: 'STALE_PRICE', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_C4_stalePrice'],
  },
  {
    id: 'RT-G3', category: 'frozen', item: 9, fixture: 'main',
    title: 'Payment while the whole consortium status is FROZEN (global freeze, then two members unfreeze)',
    setup: [{ kind: 'custom', name: 'global', params: { action: 'global-freeze' } }],
    input: { kind: 'agent-op', callData: exec(transfer('$landlord', 'usdc:10')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
    forbid: { outflow: 'any', state: ['policy', 'agent', 'binding', 'hook', 'owners', 'approvals', 'ownerActions'] },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_globalStatusAppliesToEveryAccount'],
  },
];
