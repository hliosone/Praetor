# V1 result: Safe7579 creation path and hook coverage (Base Sepolia fork)

Date: 2026-10-17. Fork of https://sepolia.base.org around block 48,220,6xx, chain id 84532.

## What was run

```bash
cd spikes/V1-safe7579
./setup.sh                 # clones forge-std and webauthn-sol @ 619f20ab (pinned), kept out of git
forge test -vv             # 17 tests, all on a fork of Base Sepolia (log: .run/V1-forge-test.log)
```

Files: `src/Interfaces.sol` (own minimal interfaces for EntryPoint v0.7, the Safe7579 adapter and launchpad, Safe 1.4.1), `src/Modules.sol` (NoOwner, minimal PasskeyValidator and AgentKeyValidator, a ProbeHook that records what the adapter passes to a global hook and can refuse, a ProbeExecutor), `test/V1.t.sol`. Sources of the deployed adapter and launchpad were read from Sourcify (exact match) under `.run/V1src/` (GPL, read only, never copied). Alex's `base.mjs`, `safe7579-first-userop.mjs`, `guard-hook-allow-block-refusal-log.mjs` and `BlockTargetHook.sol` were the starting point; the account is built here in Solidity without permissionless, following permissionless 0.2.57's launchpad encoding (read from `js/node_modules`).

Addresses used: EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, adapter `0x7579EE8307284F293B1927136486880611F20002`, launchpad `0x7579011aB74c46090561ea277Ba79D510c6C00ff`, Safe 1.4.1 singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`, proxy factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, registry attester `0x000000333034E9f539ce08819E12c1b8Cb29084d`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

## Results per sub-check

| # | Check | Test | Verdict |
|---|---|---|---|
| 1 | NoOwner as the only Safe owner (threshold 1) through the launchpad, validators `[PasskeyValidator(credIdHash,x,y), AgentKeyValidator()]`, executors/hooks `[]`, 1 attester threshold 1 | `test_1_*` | PASS: owners = [NoOwner], threshold 1, both validators, executor and global hook installed |
| 2 | First userOp validated by PasskeyValidator (software P-256, low-s, UV, nonce key `uint192(uint160(validator)) << 32`), callData `setupSafe(InitData{callData: execute(batch, [setRegistry(0), installModule(4, hook), installModule(2, executor)])})` | `test_1_*` | PASS, with two corrections (traps T2, T4). **Registry: validators passed at setup do NOT need Fallback 1**: the launchpad pushes them with `initializeAccountWithValidators` during validation, before `initSafe7579` configures the registry. Executors and hooks still need `setRegistry(0)` first (Alex's finding holds). |
| 2b | Hook receives msgData + 20 bytes | `test_1`, `test_3` | PASS: msgData = original calldata followed by the 20-byte ERC-2771 sender. msgSender argument and suffix = the account itself for self-calls (init batch), the EntryPoint for userOps, the executor for `executeFromExecutor` |
| 3 | Agent userOp via AgentKeyValidator passes and runs preCheck | `test_3_agentOp_passesHook` | PASS. Agent key sending `installModule` callData: `AA24 signature error` (`test_3b`, I7) |
| 4 | I1: `execTransaction` always reverts | `test_4a` | PASS (EOA signature, NoOwner contract signature, approved-hash form) |
| 4 | I1: uninstall of the hook without the hook's approval | `test_4b`, `test_4c` | **FAIL (gap, trap T1)**: a direct `uninstallModule(4, hook, ...)` userOp signed by the passkey **removes the hook without calling preCheck**, and the hook's reverting `onUninstall` is swallowed. Through `execute(self.uninstallModule)` the hook is asked and refuses (PASS). |
| 4 | Other paths | `test_4d` to `test_4j` | PASS: direct `installModule` is hooked; uninstalling a non-hook module is hooked; nonce key 0 (owner fallback) and an unknown validator key fall back to Safe owner signatures and fail with AA24; `executeFromExecutor` reverts for a non-installed executor and is hooked for the installed one; an unknown selector reaches the adapter fallback, which runs the hook (`vm.expectCall`) then reverts `NoFallbackHandler`; direct calls from outsiders to `execute`, `installModule`, `uninstallModule`, `setRegistry` revert; a `setRegistry` userOp is refused by our validator (AA24) |
| 5 | I16: USDC `permit` and `transferWithAuthorization` with an account signature | `test_5_usdc_erc1271_closed` | PASS. USDC on Base Sepolia: name `USDC`, symbol `USDC`, 6 decimals, version `2`, `DOMAIN_SEPARATOR 0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818` = EIP-712 (name, version, 84532, USDC); implementation `0xd74cc5d436923b8ba2c179b4bCA2841D8A52C5B5` accepts ERC-1271 (its SignatureChecker calls `isValidSignature` on contracts). Positive control: an EOA permit with the same digest code succeeds. Six account signature forms all fail for both functions: agent key prefixed with AgentKeyValidator (raw and eth-signed), passkey prefixed with PasskeyValidator (validators return `0xffffffff`), empty signature (adapter checks Safe `signedMessages`, reverts "Hash not approved"), zero-address prefix and raw 65-byte signature (Safe `checkSignatures` against NoOwner, reverts) |
| 6 | I17: every non-view selector of the deployed adapter | table below | PASS except `uninstallModule` of the hook itself (T1) |
| 7 | Gas | `test_1c`, `test_3` | First op (deploy + setup + init batch): **1,350,131** actualGasUsed (executor-first order); agent op: **373,261**. Both include preVerificationGas 100,000. Inflated in this spike: forge's EVM has no RIP-7212 precompile, so WebAuthn.sol falls back to FreshCryptoLib (**353,248 gas** for one verify vs about 49k live per Alex), and the probe hook writes its whole msgData to storage on every preCheck. Real numbers come from M3 on `anvil --network optimism` and live. |

Extra probes:
- `anvil --fork-url https://sepolia.base.org --network optimism`: RIP-7212 precompile at `0x100` returns 1 for a valid vector; plain `anvil --fork-url ...` returns empty (absent). Live Base Sepolia returns 1.
- `forge test --network optimism` on a Base Sepolia fork panics in forge 1.7.1 (op-revm "Missing operator fee scalar for isthmus L1 Block").

## I17: deployed adapter, non-view entry points

| Entry point | Guard in the deployed source | Classification |
|---|---|---|
| `execute(bytes32,bytes)` | `withHook` + `onlyEntryPointOrSelf` | hook-wrapped |
| `executeFromExecutor(bytes32,bytes)` | `onlyExecutorModule` + `withHook` + `withRegistry` | hook-wrapped (installed executors only) |
| `installModule(uint256,address,bytes)` | `withHook` + `onlyEntryPointOrSelf` | hook-wrapped |
| `uninstallModule(uint256,address,bytes)` | `tryWithHook(module, ...)`: skips both hooks when `module` is the current global or selector hook; `onUninstall` runs in a try-delegatecall | hook-wrapped **except removing the hook itself: GAP (T1)** |
| `setRegistry(address,address[],uint8)` | `onlyEntryPointOrSelf`, no hook | unreachable by our validators (selector refused); a self-call via `execute` is refused by hook rule 5 |
| `initializeAccount(...)` | `onlyEntryPointOrSelf`, no hook | unreachable (selector refused); reverts once initialized |
| `initializeAccountWithValidators(...)` | `onlyEntryPointOrSelf`, no hook | unreachable after setup; reverts once initialized (cause of T3) |
| `validateUserOp(...)` | `onlyEntryPoint` | validation path by design; pays `missingAccountFunds` (ETH prefund) to the EntryPoint outside the hook (T10) |
| `fallback()` | `receiverFallback` + `withHook(msg.sig)` | hook-wrapped; no fallback handler installed |
| `receive()` | none | ETH receipt only |

Safe 1.4.1 singleton (reached before the adapter): `execTransaction` closed by NoOwner; `execTransactionFromModule(ReturnData)` only for enabled modules (the adapter); `addOwnerWithThreshold`, `removeOwner`, `swapOwner`, `changeThreshold`, `enableModule`, `disableModule`, `setFallbackHandler`, `setGuard` require `msg.sender == safe` (only via `execTransaction`, a hooked self-call, or a hooked delegatecall, all refused); `approveHash` only by owners (NoOwner never calls); `setup` once; `simulateAndRevert` always reverts.

## Overall verdict

**PASS** (no Fallback 1, no Fallback 2): the creation path of spec 00 works with NoOwner and a PasskeyValidator-validated first op. Two spec changes are required (T1 critical for I1, T2), plus T3 and T4.

## Traps (each with the default to apply)

1. **T1 (critical, I1)**: the hook cannot block its own removal. Safe7579's `uninstallModule` skips pre/post hooks when the module is the installed hook and swallows an `onUninstall` revert, so any validator that accepts raw `uninstallModule` callData (spec 03 PasskeyValidator does) lets the owner passkey alone remove MandateHook, without the bank. Default: PasskeyValidator accepts only `execute` (plus `setupSafe` for the first op, T4). Module changes go through `execute(single, account, installModule|uninstallModule(...))`; MandateHook's execute preCheck allows that one self-call shape only with a live `moduleApprovals[account][callHash(account, 84532, account, 0, innerData)]`, consumes it there (for a hook uninstall the inner preCheck never runs), records the approved inner call in transient storage so the inner `installModule` preCheck (msgSender = account) accepts it, and sets `uninstalling` so the outer postCheck, still called on the removed hook, returns. Every other `target == account` stays HIDDEN_CALL.
2. **T2**: the spec's init batch order `[setRegistry(0), installModule(4, hook), installModule(2, executor)]` sends the executor install through the hook just installed (preCheck with msgSender = account); MandateHook refuses (TIER3_REQUIRED) and the first op fails. Default: `[setRegistry(0), installModule(2, StandingOrders), installModule(4, MandateHook)]` (proved in `test_1c`).
3. **T3**: a failed first op bricks the counterfactual address: its validation phase (validator list init, validator `onInstall`) persists even though `setupSafe` reverts, and every retry fails `AA23 reverted` / `InvalidUserOperationData()` (proved in `test_1b`). Default: the bundler simulates the first op (`eth_call` of `handleOps` or `simulateHandleOp`) and never submits it unless it succeeds; if an address is ever bricked, the api picks a new salt.
4. **T4**: PasskeyValidator must also accept the launchpad's `setupSafe(InitData)` selector (`0xd9ed0e8f`) or no account can be created. After setup that selector lands in the hooked adapter fallback (no handler), so accepting it is harmless.
5. **T5**: the hook gets `msgData = calldata || 20-byte sender`; MandateHook must strip the suffix before decoding and before the canonical batch re-encoding check (spec 03 already says so; confirmed).
6. **T6**: forge 1.7.1 fork tests have no RIP-7212 precompile (FCL fallback, about 353k gas per WebAuthn verify) and `forge test --network optimism` panics on Base Sepolia forks. Default: Foundry fork tests accept FCL gas; WebAuthn gas figures in the gas report come from `anvil --network optimism` or live.
7. **T7**: the local stack's anvil needs `--network optimism` to expose `0x100` (verified). Default: compose runs `anvil --fork-url ... --chain-id 84532 --network optimism`.
8. **T8**: low-entropy test keys (example `0xE0A`) are EIP-7702-delegated by third parties on Base Sepolia (`0xef0100...` code), which changes signature paths on a fork. Default: every test key is `keccak256(label)`.
9. **T9**: the empty-signature ERC-1271 path reads Safe `signedMessages`, which `execute(delegatecall, SignMessageLib)` could write. Closed only because the hook refuses delegatecall. Default: keep a red-team case "delegatecall to SignMessageLib then USDC permit with empty signature" tied to I16.
10. **T10**: `validateUserOp` pays the ETH prefund to the EntryPoint outside the hook. Bounded by gas limits, zero with PraetorPaymaster, and accounts hold no ETH. Default: the bundler always sponsors; I14 tests cover tokens (USDC, tXAU, tXAG), and the self-assessment mentions the ETH prefund.
11. **T11**: uninstalling a validator needs the linked-list predecessor in `deInitData` (`abi.encode(prev, data)`); relevant for SET_OWNER_KEY / recovery only if validators are ever swapped (spec keeps them installed and changes keys inside them).
