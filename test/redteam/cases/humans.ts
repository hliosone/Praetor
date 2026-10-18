// Spec 08 items 7 to 9: human approvals (Tier2Approval, SOTER), payouts and standing orders, actions while FROZEN.
import type { CaseInput } from '../lib/case.js';
import { approve, exec, payout, swap, transfer } from './calls.js';

export const humanCases: CaseInput[] = [
  // ---------------------------------------------------------------- 7. approvals
  {
    id: 'RT-51', category: 'approvals', item: 7, fixture: 'approvals',
    title: 'Replay a used Tier2Approval: register the same signed approval again',
    input: { kind: 'custom', name: 'tier2', params: { variant: 'replay' } },
    expect: { layer: 'hook', error: 'DigestUsed' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_approvalReplayAndSlotRules'],
  },
  {
    id: 'RT-52', category: 'approvals', item: 7, fixture: 'approvals',
    title: 'Reuse a consumed approval: send the approved call a second time',
    setup: [{ kind: 'custom', name: 'register-approval', params: { call: transfer('$attacker', 'usdc:150'), execute: true } }],
    input: { kind: 'agent-op', callData: exec(transfer('$attacker', 'usdc:150')) },
    expect: { layer: 'hook', reason: 'UNKNOWN_PAYEE', tier: 'T2_HUMAN' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_T2ApprovalLiftsAndIsBoundToTheCall'],
  },
  {
    id: 'RT-53', category: 'approvals', item: 7, fixture: 'approvals',
    title: 'The owner\'s passkey assertion for one call presented with another callHash',
    input: { kind: 'custom', name: 'tier2', params: { variant: 'other-callhash' } },
    expect: { layer: 'hook', error: 'BadOwnerAuth' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_approvalRefusesWrongPasskeyOrUnknownCredential'],
  },
  {
    id: 'RT-54', category: 'approvals', item: 7, fixture: 'approvals',
    title: 'A live approval of call A does not lift call B (other payee)',
    setup: [{ kind: 'custom', name: 'register-approval', params: { call: transfer('$attacker2', 'usdc:150') } }],
    input: { kind: 'agent-op', callData: exec(transfer('$attacker', 'usdc:150')) },
    expect: { layer: 'hook', reason: 'UNKNOWN_PAYEE', tier: 'T2_HUMAN' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_T2ApprovalLiftsAndIsBoundToTheCall'],
  },
  {
    id: 'RT-55', category: 'approvals', item: 7, fixture: 'approvals',
    title: 'Register an approval that has already expired',
    input: { kind: 'custom', name: 'tier2', params: { variant: 'expired' } },
    expect: { layer: 'hook', error: 'BadExpiry' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_approvalExpiryWindow'],
  },
  {
    id: 'RT-56', category: 'approvals', item: 7, fixture: 'soter',
    title: 'SOTER approval whose counter does not increase (replayed counter)',
    input: { kind: 'custom', name: 'soter', params: { variant: 'counter-replay' } },
    expect: { layer: 'hook', error: 'BadSoter' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_soterCounterAndBinding'],
  },
  {
    id: 'RT-57', category: 'approvals', item: 7, fixture: 'soter',
    title: 'SOTER approval from another phone (another binding), signed by the real attester',
    input: { kind: 'custom', name: 'soter', params: { variant: 'other-binding' } },
    expect: { layer: 'hook', error: 'BadSoter' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_soterCounterAndBinding'],
  },
  {
    id: 'RT-58', category: 'approvals', item: 7, fixture: 'soter',
    title: 'SOTER approval signed by a key that is not an active attester',
    input: { kind: 'custom', name: 'soter', params: { variant: 'inactive-attester' } },
    expect: { layer: 'hook', error: 'BadSoter' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_soterRefusesWrongDigestAccountExpiryOrInactiveAttester'],
  },
  {
    id: 'RT-59', category: 'approvals', item: 7, fixture: 'soter',
    title: 'SET_OWNER_KEY authorised by SOTER (attester-signed, bank co-signed) instead of a passkey',
    input: { kind: 'custom', name: 'soter', params: { variant: 'set-owner-key' } },
    expect: { layer: 'hook', error: 'BadOwnerAuth' },
    foundry: ['contracts/base/test/unit/MandateHookOwner.t.sol::test_setOwnerKeyPasskeyAndBankOnly'],
  },

  // ---------------------------------------------------------------- 8. payouts and standing orders
  {
    id: 'RT-60', category: 'payouts', item: 8, fixture: 'payouts',
    title: 'Payout through a SUSPENDED payout partner',
    input: { kind: 'agent-op', callData: exec(approve('$usdc', '$rail', 'usdc:50'), payout('$suspendedPartner', 'usdc:50')) },
    expect: { layer: 'hook', reason: 'COUNTERPARTY_NOT_APPROVED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_D3_partnerNotActive'],
    note: 'A suite-owned partner address activated by the bank then suspended by one member; the real partner is untouched.',
  },
  {
    id: 'RT-61', category: 'payouts', item: 8, fixture: 'payouts',
    title: 'Payout through an address that is not a payout partner',
    input: { kind: 'agent-op', callData: exec(approve('$usdc', '$rail', 'usdc:50'), payout('$attacker', 'usdc:50')) },
    expect: { layer: 'hook', reason: 'COUNTERPARTY_NOT_APPROVED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_D3_partnerNotActive'],
  },
  {
    id: 'RT-62', category: 'payouts', item: 8, fixture: 'cn',
    title: 'Alipay+ payout for a user whose KYC jurisdiction is CN (payouts blocked)',
    input: { kind: 'agent-op', callData: exec(approve('$usdc', '$rail', 'usdc:100'), payout('$partner', 'usdc:100')) },
    expect: { layer: 'hook', reason: 'JURISDICTION_BLOCKED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_D4_jurisdictionBlocked'],
  },
  {
    id: 'RT-63', category: 'payouts', item: 8, fixture: 'standing',
    title: 'Standing order triggered twice in the same period',
    input: { kind: 'custom', name: 'standing-order', params: { variant: 'trigger-twice' } },
    expect: { layer: 'executor', error: 'NotDue' },
    foundry: ['contracts/base/test/unit/StandingOrders.t.sol::test_directOrderPaysOncePerPeriodAndAnyoneTriggers'],
  },
  {
    id: 'RT-64', category: 'payouts', item: 8, fixture: 'standing',
    title: 'Standing order of 2,500 USDC (above the mandate hard cap) triggered',
    input: { kind: 'custom', name: 'standing-order', params: { variant: 'over-hard-cap' } },
    expect: { layer: 'hook', reason: 'OVER_HARD_CAP' },
    foundry: ['contracts/base/test/unit/StandingOrders.t.sol::test_hookStillRefusesFrozenSanctionsJurisdictionPartnerAndCaps'],
    note: 'The bank co-signs an order up to its own per-transaction cap; the hook still applies the lower mandate hard cap at each payment.',
  },
  {
    id: 'RT-65', category: 'payouts', item: 8, fixture: 'standing',
    title: 'Standing order of 6,000 USDC (above the bank per-transaction cap) proposed',
    input: { kind: 'custom', name: 'standing-order', params: { variant: 'over-bank-cap' } },
    expect: { layer: 'bank', error: 'per-transaction cap' },
  },

  // ---------------------------------------------------------------- 9. while FROZEN (regulator, one signature)
  {
    id: 'RT-66', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'Payment to an allowlisted payee while FROZEN',
    input: { kind: 'agent-op', callData: exec(transfer('$landlord', 'usdc:10')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_rule1_frozenWinsOverEverything'],
  },
  {
    id: 'RT-67', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'Swap while FROZEN',
    input: { kind: 'agent-op', callData: exec(approve('$txau', '$desk', '$xau100'), swap('$txau', '$usdc', '$xau100', '1')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
  },
  {
    id: 'RT-68', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'Alipay+ payout while FROZEN',
    input: { kind: 'agent-op', callData: exec(approve('$usdc', '$rail', 'usdc:50'), payout('$partner', 'usdc:50')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
  },
  {
    id: 'RT-69', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'Due standing order triggered while FROZEN',
    input: { kind: 'custom', name: 'standing-order', params: { variant: 'frozen' } },
    expect: { layer: 'hook', reason: 'FROZEN' },
    foundry: ['contracts/base/test/unit/StandingOrders.t.sol::test_hookStillRefusesFrozenSanctionsJurisdictionPartnerAndCaps'],
  },
  {
    id: 'RT-70', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'Owner registers an approval while FROZEN, then the agent sends the call',
    setup: [{ kind: 'custom', name: 'register-approval', params: { call: transfer('$landlord', 'usdc:300') } }],
    input: { kind: 'agent-op', callData: exec(transfer('$landlord', 'usdc:300')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_approvalNeverLiftsFrozen'],
  },
  {
    id: 'RT-71', category: 'frozen', item: 9, fixture: 'frozen',
    title: 'The owner\'s own passkey payment while FROZEN (I14 binds the owner too)',
    input: { kind: 'owner-op', callData: exec(transfer('$landlord', 'usdc:10')) },
    expect: { layer: 'hook', reason: 'FROZEN', tier: 'T0_NEVER' },
  },
  {
    id: 'RT-72', category: 'frozen', item: 9, fixture: 'main',
    title: 'Stale heartbeat: autonomous payment checked at a block time past the heartbeat',
    input: { kind: 'custom', name: 'stale-sim', params: { what: 'heartbeat', calls: [transfer('$landlord', 'usdc:10')] } },
    expect: { layer: 'hook', reason: 'STALE_STATUS', tier: 'T2_HUMAN' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_A8_staleHeartbeat'],
    note: 'Simulated (eth_call with a block time override): a real run needs the operator stopped and the shared fork clock moved (e2e F9 step 6 does it).',
  },
];
