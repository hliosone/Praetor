# Slither report (Base contracts)

Slither 0.11.6 on `contracts/base/src` (libraries, tests and scripts filtered). Run: `make slither`, which fails on any High or Medium finding outside the three detector classes explained below. Last run: M2 (2026-10-17).

**High: 0. Medium: 27, all explained below (three detector classes). Low: 52** (timestamp comparisons, constructor zero checks, events after external calls, calls in bounded loops), listed at the end.

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
