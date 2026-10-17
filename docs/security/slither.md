# Slither report

Slither 0.11.6 on `contracts/base/src` (libraries, tests and scripts filtered). Run: `make slither`, which fails on any High or Medium finding outside the three detector classes explained below. First run M2; re-run in M17 (2026-10-17) on this commit, with the FISCO contracts analysed once as well.

## Status at M17

| Scope | High | Medium | Low | `make slither` |
|---|---|---|---|---|
| Praetor's Base contracts (`contracts/base/src` without `src/vendor`) | 0 | 27, the same three explained classes as M2 | 52 | would pass |
| Vendored WeCross proxy (`src/vendor/wecross/WeCrossProxyEVM.sol`, added in M12) | 3 | 8 | 11 | filtered like `lib/` (D49), triaged below |
| FISCO contracts (`contracts/fisco/src`) | 0 | 5 (the same classes) | 13 | passes (in `make slither` since D49) |

**`make slither` passes (D49)**: it analyses `contracts/base` and `contracts/fisco` and fails on any High or Medium outside the three explained classes. The vendored WeCross proxy is third-party code filtered like `lib/`; its 3 High and 8 Medium findings are triaged one by one below (none is exploitable in Praetor's use: the proxy holds no authority and the hook verifies every message), and that triage is re-read whenever the vendored file changes.

## Base contracts (Praetor's code)

**High: 0. Medium: 27, all explained below (three detector classes). Low: 52** (timestamp comparisons, constructor zero checks, events after external calls, calls in bounded loops), listed at the end. Unchanged between M2 and M17.

## Medium findings, one by one

### `uninitialized-local` (12): zero values are intended

| Location | Variable | Why it is correct |
|---|---|---|
| `DecisionLib.evaluate` | `run` | Running totals start at zero, then the stored counters are copied in. |
| `DecisionLib._assetsOk` | `inFound`, `outFound` | Flags start false and are set while scanning the bands. |
| `DecisionLib._payment` | `r` | 0 = OK; the standing-order path skips the T2 group and keeps 0 (spec 03, S). |
| `DecisionLib._one` | `t` | Trade struct filled field by field from the calldata right after. |
| `DecisionLib.bandValues` | `e` | Only `account`, `usdc` and `oracle` are needed; they are set before use. |
| `MandateHook._preExecute` | `calls` | Assigned in the single and batch branches; every other mode reverts HIDDEN_CALL first. |
| `OwnerLib._removePayee` | `found` | Starts false; REMOVE_PAYEE reverts when nothing was removed. |
| `ConsortiumLib._signers` | `last` | Address 0 is below every signer: the first signature always passes the ascending check. |
| `PostCheckLib.prepare` | `p`, `nA`, `nS` | Counters start at zero; `p` is filled field by field. |

### `unused-return` (11): ignored values are deliberate

| Location | Ignored value | Why it is correct |
|---|---|---|
| `ConsortiumLib._signers`, `OwnerLib._bankSigned`, `OwnerLib._soter`, `AgentKeyValidator.validateUserOp`, `PraetorPaymaster.validatePaymasterUserOp` | third value of `ECDSA.tryRecover` (the bytes32 error argument) | The error enum is checked; the argument only details it. |
| `StandingOrders.execute` (2) | `executeFromExecutor` return data | The executor needs success only; a refusal reverts the whole call. |
| `PostCheckLib.prepare` | `ok` of `bandValues` | When valuation fails, `totalBefore` is 0 and the band comparison is skipped, while the bank max-weight check still runs; preCheck has already refused any swap it could not value (BAND_BREACH, T0). |
| `TreasuryDesk.quote` | `publishTime` of `getPrice` | Freshness is checked just before with `oracle.isFresh`. |
| `PayoutRail.pay` | `maxWeightBps`, `nonce` of `assetOf` | Only kind and status matter for a payout partner. |
| `Anchor.anchor` | `hasBank` of `countSigners` | Anchors need any two members, not the bank. |

### `incorrect-equality` (4): not balance-based

| Location | Comparison | Why it is correct |
|---|---|---|
| `DecisionLib._bandsOk` | `total == 0` | Empty portfolio: no weights to compare. |
| `DecisionLib._static`, `DecisionLib._oraclePrice` | `code.length == 0` | Guard before a staticcall so `check()` never reverts (I12). |
| `StandingOrders.execute` | `rail == USDC_DIRECT` | Enum comparison. |

## Low findings (52)

- **timestamp (31)**: deadlines, expiries, heartbeat, day and month buckets, price age. Time on Base is `block.timestamp` by design (spec 02); the few seconds of sequencer drift are well inside every window.
- **missing-zero-check (10)**: constructor parameters (hook, oracle, feeder, members). Members are checked against zero and duplicates in `MandateHook`; the others are written by the deploy script and verified by `test/unit/Deploy.t.sol`.
- **reentrancy-events (6), reentrancy-benign (1)**: events emitted after calls to our own tokens, the desk, Circle USDC or the account. State is updated before the external call where it matters (`StandingOrders.nextDue`, `PayoutRail.withdrawn`, the hook's counters before execution).
- **calls-loop (4)**: allowance reads in postCheck and module calls in recovery, bounded by the batch length and four owner keys.

## Vendored WeCross proxy (M12, triaged in M17)

`WeCrossProxyEVM.sol` is WeCross's own `WeCrossProxy.sol` (Apache-2.0, v1.4.0) with the BFS precompile replaced by an owner-set name map (D42). On Base it routes the single name `inbox` to `WeCrossInbox`. It holds no tokens and no authority: `WeCrossInbox.deliver` and the hook's `apply*` setters are permissionless, and every consortium message is accepted only on valid member signatures checked by `MandateHook` (I3). Whatever the proxy does, it can delay or drop a message, never forge one. The upstream code is kept unchanged on purpose (fewer differences to review against WeCross).

| Detector (impact) | Location | Why it is not a vulnerability here |
|---|---|---|
| `weak-prng` (High) | `uint256ToString`, `_value % 10` | False positive: decimal digit extraction for a string, not randomness. |
| `encode-packed-collision` (High) | `callContract(address,string,bytes)`: `abi.encodePacked(sig, _args)` | `sig` is a fixed 4-byte selector, so the concatenation is the standard calldata layout; there is no ambiguity to collide. |
| `encode-packed-collision` (High) | `getXATransactionStepKey`: `encodePacked(_transactionID, uint256ToString(seq))` | Key of WeCross XA transaction steps. Praetor never uses XA transactions (`sendTransactionWithXa`, `startXATransaction`): the router sends plain `sendTransaction` calls. A collision could at worst confuse two XA step records of the proxy itself. |
| `reentrancy-no-eth` (Medium) | `sendTransaction`: `transactions[_uid]` written after the call | The only target is `WeCrossInbox`, which calls the hook and never calls back into the proxy. The record only de-duplicates a router `uid`; a reentrant call would at worst apply a message once more, and the hook's nonce rule (stored + 1, I18) refuses any replay. |
| `reentrancy-no-eth` (Medium) | `sendTransactionWithXa`, `rollbackXATransaction` | XA paths, unused by Praetor. |
| `incorrect-equality` (Medium, 3) | `uint256ToString` (`_value == 0`), `isValidXATransactionSep` (`index == 0`), `sameString` (hash equality) | Integer and hash comparisons, not balances. |
| `uninitialized-local` (Medium, 2) | `parseAddress.v`, `uint256ToString.result` | Zero start values, as upstream intends. |
| Low (11) | `timestamp` (7), `calls-loop` (2), `reentrancy-benign` (2) | XA timeouts and loops over the paths of one XA transaction; unused by Praetor. |

Tests: `contracts/base/test/vendor/WeCrossProxyEVM.t.sol` (routing by name, a `uid` is not delivered twice, owner-only path setters) and the integration test `test/integration/wecross.test.ts` (a freeze crosses FISCO to Base through WeCross within 60 s).

## FISCO contracts (analysed once in M17)

`slither .` in `contracts/fisco` with the same filters: **High 0, Medium 5, Low 13**. Spec 08 asks for Slither on both contract trees; `make slither` covers only `contracts/base`, so this run is manual until the gate is extended.

| Detector | Location | Why it is correct |
|---|---|---|
| `uninitialized-local` | `BaseOutbox.pending` (`n`) | Counter starting at zero. |
| `unused-return` | `Board._ready` ignores the outbox id of `enqueue` | The id is in the outbox's `Enqueued` event; the board needs nothing back. |
| `unused-return` | `MandateRegistry._check` ignores `kind` and `nonce` of `assetOf` | Only the status and the bank's max weight matter for a policy band. |
| `unused-return` | `Board.sign` ignores the third value of `ECDSA.tryRecover` | The error enum is checked; the argument only details it. |
| `unused-return` | `Board.onlyMember` ignores the role of `roleOf` | Any member may open; bank-only boards use `onlyBank`. |

Low: `timestamp` (8: proposal deadlines, the heartbeat bound and policy expiry on FISCO time converted from milliseconds to seconds; some are loop bounds Slither attributes to time), `missing-zero-check` (3: `MandateRegistry`'s USDC address and `BaseOutbox.setHub`, both set once by the deployer), `reentrancy-events` (1: `BaseOutbox.requestWeCross` emits after calling the WeCross hub, which holds no authority over the outbox) and `calls-loop` (1: `MandateRegistry._check` reads the asset registry for each policy band, at most four).
