// Spec 08 items 4 to 6: hidden execution shapes, account bypasses, forged consortium messages. The agent-key path is
// what a compromised mcp could send (it is agent-signer's only caller); the passkey path shows that even the owner's
// key cannot bypass the hook.
import type { CaseInput } from '../lib/case.js';
import { exec, execMode, transfer } from './calls.js';

const loosen = (signers: { key: string; domain?: string; malleate?: boolean }[], deadline = '$now+600', keepOrder = false) => ({
  kind: 'attestation' as const, type: 'StatusAttestation' as const, keepOrder,
  message: { account: '$account', status: 0, nonce: '$statusNonce+1', deadline, fiscoRef: '$zero32' }, signers,
});

export const contractCases: CaseInput[] = [
  // ---------------------------------------------------------------- 4. execution shapes
  {
    id: 'RT-22', category: 'execution-shape', item: 4, fixture: 'owner',
    title: 'delegatecall execution mode (owner passkey)',
    input: { kind: 'owner-op', callData: execMode('delegatecall', [{ to: '$attacker', data: '0x' }]) },
    expect: { layer: 'hook', reason: 'HIDDEN_CALL' },
    foundry: ['contracts/base/test/unit/MandateHookExecute.t.sol::test_executionModesOtherThanSingleAndBatchAreHidden'],
  },
  {
    id: 'RT-23', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'delegatecall execution mode (agent key)',
    input: { kind: 'agent-op', callData: execMode('delegatecall', [{ to: '$attacker', data: '0x' }]) },
    expect: { layer: 'agent-signer' },
    foundry: ['contracts/base/test/unit/AgentKeyValidator.t.sol::test_refusesOtherCallTypes', 'contracts/base/test/unit/MandateHookExecute.t.sol::test_executionModesOtherThanSingleAndBatchAreHidden'],
  },
  {
    id: 'RT-24', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'ETH value on a call (1 wei to an allowlisted payee)',
    input: { kind: 'agent-op', callData: exec({ to: '$landlord', value: '1', data: '0x' }) },
    expect: { layer: 'hook', reason: 'HIDDEN_CALL', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_rule5_hiddenCalls'],
  },
  {
    id: 'RT-25', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'Self-call execute(account.installModule(executor)) with the agent key',
    input: { kind: 'agent-op', callData: exec({ to: '$account', fn: 'installModule(uint256,address,bytes)', args: ['2', '$attacker', '0x'] }) },
    expect: { layer: 'agent-signer' },
    foundry: ['contracts/base/test/unit/AgentKeyValidator.t.sol::test_refusesExecuteTargetingTheAccount', 'contracts/base/test/fork/Safe7579Fork.t.sol::test_I7_agentCannotChangeModulesEvenWithAnApproval'],
  },
  {
    id: 'RT-26', category: 'execution-shape', item: 4, fixture: 'owner',
    title: 'Self-call execute(account.uninstallModule(MandateHook)) with the owner passkey, no owner + bank approval',
    input: { kind: 'owner-op', callData: exec({ to: '$account', fn: 'uninstallModule(uint256,address,bytes)', args: ['4', '$hook', '0x'] }) },
    expect: { layer: 'hook', reason: 'TIER3_REQUIRED' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I1_uninstallThroughExecuteWithoutApprovalRefused'],
  },
  {
    id: 'RT-27', category: 'execution-shape', item: 4, fixture: 'owner',
    title: 'Raw uninstallModule(MandateHook) userOp signed by the owner passkey',
    input: { kind: 'owner-op', callData: { fn: 'uninstallModule(uint256,address,bytes)', args: ['4', '$hook', '0x'] } },
    expect: { layer: 'validator', error: '^AA24' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I1_rawUninstallRefusedByThePasskeyValidator'],
  },
  {
    id: 'RT-28', category: 'execution-shape', item: 4, fixture: 'owner',
    title: 'try-mode execute (exec type 0x01) of a 1 USDC payment',
    input: { kind: 'owner-op', callData: execMode('try-single', [transfer('$landlord', 'usdc:1')]) },
    expect: { layer: 'hook', reason: 'HIDDEN_CALL' },
    foundry: ['contracts/base/test/unit/MandateHookExecute.t.sol::test_executionModesOtherThanSingleAndBatchAreHidden'],
  },
  {
    id: 'RT-29', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'Non-canonical batch encoding (extra bytes after the executions)',
    input: { kind: 'agent-op', callData: execMode('batch', [transfer('$landlord', 'usdc:1')], `0x${'00'.repeat(31)}01`) },
    expect: { layer: 'hook', reason: 'HIDDEN_CALL' },
    foundry: ['contracts/base/test/unit/MandateHookExecute.t.sol::test_nonCanonicalBatchIsHidden', 'contracts/base/test/fuzz/HookFuzz.t.sol::testFuzz_nonCanonicalBatches'],
    note: 'The decoded call alone is allowed (check() says OK, so no RefusalLog record): only the canonical-encoding rule stops it.',
  },
  {
    id: 'RT-30', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC approve(attacker EOA, max)',
    input: { kind: 'agent-op', callData: exec({ to: '$usdc', fn: 'approve(address,uint256)', args: ['$attacker', '$max256'] }) },
    expect: { layer: 'hook', reason: 'SELECTOR_NOT_ALLOWED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_usdcSelectorsOutsideThePatternRefused'],
  },
  {
    id: 'RT-31', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC transferFrom(account, attacker, 100)',
    input: { kind: 'agent-op', callData: exec({ to: '$usdc', fn: 'transferFrom(address,address,uint256)', args: ['$account', '$attacker', 'usdc:100'] }) },
    expect: { layer: 'hook', reason: 'SELECTOR_NOT_ALLOWED', tier: 'T0_NEVER' },
    foundry: ['contracts/base/test/unit/MandateHookDecide.t.sol::test_usdcSelectorsOutsideThePatternRefused'],
  },
  {
    id: 'RT-32', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC permit(account, attacker, max) called from the account',
    input: {
      kind: 'agent-op',
      callData: exec({ to: '$usdc', fn: 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', args: ['$account', '$attacker', '$max256', '$now+3600', '27', '$zero32', '$zero32'] }),
    },
    expect: { layer: 'hook', reason: 'SELECTOR_NOT_ALLOWED', tier: 'T0_NEVER' },
  },
  {
    id: 'RT-33', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC permit pulled by an attacker with an ERC-1271 account signature made by the owner passkey',
    input: { kind: 'custom', name: 'erc1271', params: { method: 'permit', signature: 'passkey' } },
    expect: { layer: 'usdc' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail'],
  },
  {
    id: 'RT-34', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC permit with an empty ERC-1271 account signature',
    input: { kind: 'custom', name: 'erc1271', params: { method: 'permit', signature: 'empty' } },
    expect: { layer: 'usdc' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail'],
  },
  {
    id: 'RT-35', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC transferWithAuthorization (EIP-3009) with an ERC-1271 passkey signature',
    input: { kind: 'custom', name: 'erc1271', params: { method: 'transferWithAuthorization', signature: 'passkey' } },
    expect: { layer: 'usdc' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail'],
  },
  {
    id: 'RT-36', category: 'execution-shape', item: 4, fixture: 'shape',
    title: 'USDC transferWithAuthorization with a secp256k1 signature routed to the agent-key validator',
    input: { kind: 'custom', name: 'erc1271', params: { method: 'transferWithAuthorization', signature: 'agent' } },
    expect: { layer: 'usdc' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail'],
    note: 'agent-signer signs userOps only, so a stand-in key signs here; AgentKeyValidator answers 0xffffffff to every ERC-1271 request whatever the signature (Foundry test with the real key).',
  },

  // ---------------------------------------------------------------- 5. account bypasses
  {
    id: 'RT-37', category: 'account-bypass', item: 5, fixture: 'owner',
    title: 'Safe execTransaction by an outsider, presenting a contract signature of the NoOwner owner',
    input: {
      kind: 'tx',
      call: {
        to: '$account', fn: 'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
        args: ['$usdc', '0', '$transferToAttacker', '0', '0', '0', '0', '$zeroAddress', '$zeroAddress', '$noOwnerSig'],
      },
    },
    expect: { layer: 'safe', error: 'GS0' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I1_execTransactionAlwaysReverts'],
  },
  {
    id: 'RT-38', category: 'account-bypass', item: 5, fixture: 'owner',
    title: 'userOp with nonce key 0 (Safe owner fallback), passkey-signed and re-sponsored',
    input: { kind: 'owner-op', nonceKey: 'zero', callData: exec(transfer('$landlord', 'usdc:1')) },
    expect: { layer: 'validator', error: '^AA2' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_creationPathWithNoOwnerPasskeyAndPaymaster'],
  },
  {
    id: 'RT-39', category: 'account-bypass', item: 5, fixture: 'shape',
    title: 'Agent key sends raw installModule calldata (not an execute)',
    input: { kind: 'agent-op', callData: { fn: 'installModule(uint256,address,bytes)', args: ['2', '$attacker', '0x'] } },
    expect: { layer: 'agent-signer' },
    foundry: ['contracts/base/test/unit/AgentKeyValidator.t.sol::test_refusesInstallAndUninstallModule'],
  },
  {
    id: 'RT-40', category: 'account-bypass', item: 5, fixture: 'owner',
    title: 'executeFromExecutor called on the account by an outsider',
    input: {
      kind: 'tx',
      call: { to: '$account', fn: 'executeFromExecutor(bytes32,bytes)', args: ['$zero32', '$packedTransferToAttacker'] },
    },
    expect: { layer: 'safe' },
    foundry: ['contracts/base/test/fork/Safe7579Fork.t.sol::test_I17_outsidersCannotReachAnyNonViewEntryPoint'],
  },

  // ---------------------------------------------------------------- 6. consortium messages (the account is FROZEN by the regulator)
  {
    id: 'RT-41', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Forged StatusAttestation (two non-member keys) to unfreeze the account',
    input: loosen([{ key: 'attacker' }, { key: 'attacker2' }]),
    expect: { layer: 'hook', error: 'BadSignatures' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_signerSetRules'],
  },
  {
    id: 'RT-42', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Loosening (unfreeze) signed by one member only',
    input: loosen([{ key: 'regulator' }]),
    expect: { layer: 'hook', error: 'NotEnoughSigners' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_looseningNeedsTwoMembers'],
  },
  {
    id: 'RT-43', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Replay of the delivered freeze attestation (old nonce)',
    input: { kind: 'custom', name: 'replay-status', params: {} },
    expect: { layer: 'hook', error: 'BadNonce' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_nonceMustBeStoredPlusOne'],
  },
  {
    id: 'RT-44', category: 'consortium', item: 6, fixture: 'bare',
    title: 'Nonce jump to 2^64 - 1 by one member (would block every later message, I18)',
    input: {
      kind: 'attestation', type: 'StatusAttestation',
      message: { account: '$account', status: 1, nonce: '$max64', deadline: '$now+600', fiscoRef: '$zero32' }, signers: [{ key: 'operator' }],
    },
    expect: { layer: 'hook', error: 'BadNonce' },
    foundry: ['contracts/base/test/fuzz/HookFuzz.t.sol::testFuzz_I18_nonce'],
  },
  {
    id: 'RT-45', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Unfreeze signed by two members after its deadline',
    input: loosen([{ key: 'bank' }, { key: 'regulator' }], '$now-60'),
    expect: { layer: 'hook', error: 'Expired' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_deadlinePassedRefused'],
  },
  {
    id: 'RT-46', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Unfreeze with the same member signature twice',
    input: loosen([{ key: 'regulator' }, { key: 'regulator' }], '$now+600', true),
    expect: { layer: 'hook', error: 'BadSignatures' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_signerSetRules'],
  },
  {
    id: 'RT-47', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Unfreeze with a malleable (high-s) second signature',
    input: loosen([{ key: 'bank' }, { key: 'regulator', malleate: true }]),
    expect: { layer: 'hook', error: 'BadSignatures' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_rejectsMalleableHighS'],
  },
  {
    id: 'RT-48', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Unfreeze signed by the right keys over another environment\'s domain ("Praetor", live)',
    input: loosen([{ key: 'bank', domain: 'Praetor' }, { key: 'regulator', domain: 'Praetor' }]),
    expect: { layer: 'hook', error: 'BadSignatures' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_otherDomainRefused'],
  },
  {
    id: 'RT-49', category: 'consortium', item: 6, fixture: 'frozen',
    title: 'Unfreeze signed by the live environment\'s member keys',
    input: loosen([{ key: 'live-bank' }, { key: 'live-regulator' }]),
    expect: { layer: 'hook', error: 'BadSignatures' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_otherDomainRefused'],
  },
  {
    id: 'RT-50', category: 'consortium', item: 6, fixture: 'main',
    title: 'Sanctions delisting signed by one member only',
    input: {
      kind: 'attestation', type: 'SanctionsAttestation',
      message: { target: '$sanctioned', listed: false, nonce: '$sanctionNonce+1', deadline: '$now+600', fiscoRef: '$zero32' }, signers: [{ key: 'regulator' }],
    },
    expect: { layer: 'hook', error: 'NotEnoughSigners' },
    foundry: ['contracts/base/test/unit/MandateHookConsortium.t.sol::test_sanctionsListOneDelistTwo'],
  },
];
