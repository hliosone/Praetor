# 03 · Contracts on Base Sepolia

Foundry project `contracts/base`, solc **0.8.28**, `evm_version = cancun`, optimizer on (200 runs), `via_ir` only where needed. Our contracts are SPDX "UNLICENSED" (repo is all-rights-reserved), except vendored MIT/Apache files, which keep their header. Libraries: forge-std, Coinbase **webauthn-sol** (MIT, pinned `619f20a` as in Alex's repo, with its FreshCryptoLib/solady deps), OpenZeppelin (MIT) for ECDSA/ERC20 helpers. **No GPL code**: own ERC-7579 interfaces (`IERC7579Module`, `IERC7579Hook`, `IERC7579Validator`, `IERC7579Executor`, account subset), own ERC-4337 v0.7 structs, own ERC-3643 implementation, own paymaster.

## Deployment (`script/Deploy.s.sol` → `infra/deployments/<env>.json`)

Members are **always** the `*_BASE_SIGNER_KEY` addresses of that environment's `.env` (local, live and sandbox have different keys); anvil test keys exist only in Foundry unit tests.
Order: NoOwner → PriceOracle → MandateHook(members, domainName, soterCounterStrict) → PasskeyValidator, AgentKeyValidator, StandingOrders (constructors take the hook) → IdentityRegistry, Compliance, tXAU, tXAG → TreasuryDesk → PayoutRail → RefusalLog → Anchor(hook) → PraetorPaymaster (+ EntryPoint deposit) → WeCrossInbox (+ the patched WeCrossProxy) → **`hook.setModules(...)` last, once, by the deployer** (validators, executor, USDC, desk, rail, oracle; tokens are classified through `assets[kind = TOKEN]`).
Bootstrap data (caps, assets, jurisdictions, attester) **goes through FISCO** (seed scripts → board contracts → Ready → bridge), so Base nonces always equal FISCO-allocated ones.

---

## NoOwner

The Safe's only native owner. ERC-1271 `isValidSignature(bytes32,bytes)` and legacy `isValidSignature(bytes,bytes)` return `0xffffffff`. Result: `execTransaction` always fails, Safe7579's fallback to owner signatures for an unknown validator fails too.

## PasskeyValidator (ERC-7579 validator, type 1)

```
storage  keys[account][credIdHash] = {x, y}; keyCount[account] (≤ 4)
onInstall(abi.encode(credIdHash, x, y))
validateUserOp(userOp, userOpHash) → 0 | 1
    selector of userOp.callData ∈ {execute, installModule, uninstallModule}   (else fail)
    (credIdHash, auth) = abi.decode(userOp.signature, (bytes32, WebAuthn.WebAuthnAuth))
    WebAuthn.verify(abi.encode(userOpHash), requireUV = true, auth, keys[account][credIdHash])
isValidSignatureWithSender(...) → 0xffffffff   always (I16)
setKey(account, credIdHash, x, y)   only MandateHook (SET_OWNER_KEY, recovery); x = y = 0 removes; never removes the last key
ownerKey(account, credIdHash) view
```

## AgentKeyValidator (ERC-7579 validator, type 1)

```
storage  agents[account] = {address key; uint48 validUntil; bool revoked}
validateUserOp(userOp, userOpHash)
    selector of userOp.callData == execute              (else SIG_VALIDATION_FAILED)
    signer = ECDSA.recover(toEthSignedMessageHash(userOpHash), userOp.signature)
    fail if key == 0 || signer != key || revoked
    return packValidationData(false, validUntil, 0)
isValidSignatureWithSender(...) → 0xffffffff   always (I16)
setKey(account, key, validUntil) (requires 0 < validUntil < 2^48) / revoke(account)   only MandateHook
agentOf(account) view
```

## MandateHook (ERC-7579 hook, type 4): the policy engine

Port of BSA Sentry's `decide.rs` (rule order is part of the contract), extended to portfolio, consortium status and identity. Start from Alex's `BlockTargetHook.sol` (execute decoding and install path proven). `account = msg.sender` in preCheck/postCheck (Safe7579 calls hooks through the Safe).

### Storage

```
members: bank, regulator, operator (immutable; rotating a member Base key = new hook + MODULE_CHANGE, documented)
domainName (immutable), soterCounterStrict (immutable)
modules: passkeyValidator, agentKeyValidator, standingOrders, usdc, desk, payoutRail, oracle (set once)
globalStatus{status, nonce}; status[account]{status, nonce}; heartbeat{epoch, validUntil}
caps[riskProfile]{perTxCap, dailyCap, monthlyCap, nonce}
kya[account]{agentKey, agentDidHash, kycCredentialHash, mandateCredentialHash, kycLevel, riskProfile, jurisdiction, agentMeasurement, validUntil, nonce}
assets[asset]{kind, status, maxWeightBps, nonce}
sanctioned[target]{listed, nonce}; jurisdictions[bytes2]{payoutBlocked, nonce}; attesters[attester]{measurement, active, nonce}
policy[account], policyHash[account]
spent[account][day], spentMonth[account][month], count[account][day], rebalances[account][day]
approvals[account][callHash] = {expiresAt, consumed}; usedDigest[digest]
binding[account]; soterCounter[bindingHash]; paused[account]
recovery[account]{payloadHash, executableAt}; moduleApprovals[account][callHash] = {expiresAt, consumed}
transient: uninstalling (set in preCheck when an uninstall of this hook is approved, read in onUninstall/postCheck)
```

### Entry points

```
onInstall(bytes)      registers msg.sender; status ACTIVE, no policy, no KYA ⇒ refuses everything until F1/F3 finish
onUninstall(bytes)    only when the transient `uninstalling` flag is set for msg.sender; clears the account
isModuleType(4), isInitialized(account)

preCheck(address msgSender, uint256 msgValue, bytes msgData) returns (bytes hookData)
    data = msgData minus the 20 appended bytes (Safe7579 appends the original caller, ERC-2771 style)
    execute(bytes32 mode, bytes exec):
        mode: callType 0x00 single | 0x01 batch; execType 0x00 only; modeSelector and payload zero; else HIDDEN_CALL
        batch: decode Execution[], **re-encode and compare with the raw bytes** (canonical encoding), else HIDDEN_CALL
        decide each call in order with cumulative accounting and approve-pattern pairing
    executeFromExecutor(...): msgSender must be standingOrders → standing-order rules (S); else HIDDEN_CALL
    installModule / uninstallModule: live moduleApprovals[account][callHash(account, 84532, account, 0, data)] → consume
        (and set `uninstalling` if it uninstalls this hook); else TIER3_REQUIRED
    any other selector → HIDDEN_CALL
    allow: update counters, consume approvals, emit Decision. refuse: revert MandateRefused(reason, callHash).
    hookData = abi.encode(kind, pre-trade balances, (token, spender) pairs to check)
postCheck(bytes hookData)
    if `uninstalling`: return
    swaps: recompute weights with real balances and oracle prices → BAND_BREACH if I15 broken
    approve pattern: IERC20(token).allowance(account, spender) == 0, else SELECTOR_NOT_ALLOWED

check(account, target, value, data) view returns (uint8 reason, uint8 tier, bytes32 callHash)
checkBatch(account, Execution[] calls) view returns (uint8[] reasons, uint8[] tiers, bytes32[] callHashes)
    Same internal `_decide` as preCheck (simulate = true), no writes; a live approval counts as OK; never reverts (I12).
```

### Decision order for one call (tested rule against neighbour, like decide.rs)

```
 1  eff = max(globalStatus, status[account]); eff == FROZEN                       → FROZEN            T0
 2  policy unset                                                                   → NO_POLICY         T0
 3  kya missing | kycLevel == 0 | kya.validUntil < now                             → KYA_INVALID       T0
 4  policy.validUntil < now                                                        → SESSION_EXPIRED   T0
 5  value != 0 | target == account                                                 → HIDDEN_CALL       T0
 6  classify (target, selector):
    A  USDC.transfer(to, amt)                         payment
    B  token.approve(spender, amt), token ∈ {USDC, tXAU, tXAG}   approve-pattern
    C  desk.swap(tokenIn, tokenOut, amountIn, minOut) rebalance
    D  payoutRail.pay(partner, amt, rail, merchantRef, paymentRef), rail ≠ USDC_DIRECT   payout
    other selector on a known contract (USDC incl. permit/transferWithAuthorization/transferFrom, tokens, desk, rail) → SELECTOR_NOT_ALLOWED T0
    anything else                                                                  → TARGET_NOT_ALLOWED T0

 A/D payment
 A1 amt == 0 | amt > 2^128                                                         → INVALID_AMOUNT    T0
 A2 sanctioned[to] (A) | sanctioned[partner] (D)                                   → SANCTIONED        T0
 D3 assets[partner] not ACTIVE PAYOUT_PARTNER                                      → COUNTERPARTY_NOT_APPROVED T0
 D4 jurisdictions[kya.jurisdiction].payoutBlocked                                  → JURISDICTION_BLOCKED T0
 A5 amt > min(policy.hardCap, caps.perTxCap)                                       → OVER_HARD_CAP     T0
 A6 spentDay+amt > caps.dailyCap | spentMonth+amt > caps.monthlyCap                → BUDGET_EXCEEDED   T0
    ── T2 group: first failing reason; a live approval for callHash turns it into OK ──
 A7 eff == RESTRICTED | paused | recovery pending                                  → RESTRICTED        T2
 A8 heartbeat.validUntil < now                                                     → STALE_STATUS      T2
 A9 to ∉ policy.payees (A) | merchantKey(partner, merchantRef) ∉ policy.merchants (D) → UNKNOWN_PAYEE  T2
 A10 amt > policy.autoCap                                                          → OVER_AUTO_CAP     T2
 A11 spentDay+amt > dailyBudget | spentMonth+amt > monthlyBudget                   → BUDGET_EXCEEDED   T2
 A12 count[day] >= dailyCount                                                      → COUNT_EXCEEDED    T2
 A13 usdcBalance < amt + bufferUsdc                                                → BUFFER_BREACH     T2
     all pass → OK T1.   On allow: spent/spentMonth += amt; count += 1.

 C rebalance
 C1 amountIn == 0 | amountIn > 2^128                                               → INVALID_AMOUNT    T0
 C2 assets[desk] not ACTIVE DESK                                                   → COUNTERPARTY_NOT_APPROVED T0
 C3 tokenOut not ACTIVE | tokenIn DELISTED | either not in policy.bands | tokenIn == tokenOut | neither is USDC → ASSET_NOT_APPROVED T0
 C4 oracle publishTime of a non-USDC side older than maxPriceAge                   → STALE_PRICE       T0
 C5 minOut < oracleOut * (10000 - maxSlippageBps) / 10000                          → SLIPPAGE          T0
 C6 projected weight(tokenOut) > assets[tokenOut].maxWeightBps (bank limit)        → BAND_BREACH       T0
    ── T2 group ──
 C7 RESTRICTED (as A7), C8 STALE_STATUS (as A8)
 C9 valueUsd6(amountIn) > maxTradeUsd | rebalances[day] >= maxRebalancesPerDay     → REBALANCE_LIMIT   T2
 C10 projected weights: any asset outside [min,max] not strictly closer to target than before → BAND_BREACH T2
 C11 projected USDC < bufferUsdc                                                   → BUFFER_BREACH     T2
     all pass → OK T1.   On allow: rebalances += 1.

 B approve-pattern (the approve inherits the decision of the call it pairs with)
 B1 the next call in the same batch must be:
      spender == desk:       desk.swap with tokenIn == token and amountIn == amt
      spender == payoutRail: token == USDC and rail.pay with amount == amt
    otherwise (single call, wrong pair, other spender)                             → SELECTOR_NOT_ALLOWED T0
 B2 postCheck requires allowance(account, spender) == 0 after execution

 S standing-order path (executeFromExecutor from StandingOrders, single transfer or [approve, rail.pay])
    Applies: 1 FROZEN, 2 NO_POLICY, 3 KYA_INVALID, 4 SESSION_EXPIRED, A1, A2, D3, D4, A5, A6, B1/B2.
    Not applied: RESTRICTED/STALE/pause, payee list, autoCap, user budgets/count, buffer (owner and bank pre-approved this order).
    On allow: spent/spentMonth += amt (bank caps include it); count unchanged.
```

### Consortium setters (permissionless; signatures are the authority)

All take `bytes[] sigs` (distinct members, sorted ascending), check `now ≤ deadline` and **`nonce == stored + 1`** (I18):
```
applyStatus(StatusAttestation, sigs)            tighten: ≥1; same/looser: ≥2
applyHeartbeat(HeartbeatAttestation, sigs)      ≥1; epoch == stored + 1; validUntil ≤ now + 1 day
applyCaps(CapsAttestation, sigs)                bank
applyKYA(KYAAttestation, sigs)                  bank
applyAsset(AssetAttestation, sigs)              any loosening component ⇒ bank; pure tightening ⇒ any 1
applySanctions(SanctionsAttestation, sigs)      list: 1; delist: 2
applyJurisdiction(JurisdictionAttestation, sigs) block: 1; unblock: 2
applyAttester(AttesterAttestation, sigs)        activate: bank; deactivate: any 1
```
Signature checks: EIP-712 digest with this deployment's domain, OpenZeppelin `ECDSA.recover` (rejects malleable s).

### Human approvals and owner actions

```
registerApproval(Tier2Approval a, OwnerAuth auth)
    now < a.expiresAt ≤ now + 3600 ; !usedDigest[d = digest(a)] ; slot empty, consumed or expired
    PASSKEY: (credIdHash, webauthn) → WebAuthn.verify(abi.encodePacked(d), true, webauthn, passkeyValidator.ownerKey(account, credIdHash))
    SOTER:   policy.soterEnabled ; attesters[recover(attesterSig)].active ; s.account == a.account ; s.digest == d ;
             s.bindingHash == binding[account] != 0 ; now < s.expiresAt ≤ now + 3600 ;
             if soterCounterStrict: s.soterCounter > soterCounter[binding] ; then soterCounter[binding] = max(stored, s.soterCounter)
    → usedDigest[d] = true ; approvals[account][callHash] = {a.expiresAt, false} ; emit ApprovalRegistered
    FROZEN still wins at execution (rule 1 runs before approvals are looked at).

applyOwnerAction(OwnerAction a, bytes payload, OwnerAuth auth, bytes[] bankSigs)
    now < a.expiresAt ≤ now + 3600 ; !usedDigest[d] ; payload ↔ payloadHash per the table in 02
    owner auth: PASSKEY, or SOTER (same checks as above) except for LINK_WECHAT and SET_OWNER_KEY (passkey only)
    bank sig over d required for: SET_POLICY, ADD_STANDING_ORDER, LINK_WECHAT, SET_AGENT_KEY, SET_OWNER_KEY, MODULE_CHANGE
    effects per the table in 02; usedDigest[d] = true; emit OwnerActionApplied
    LINK_WECHAT: proof.digest == d, proof.account == account, attester active, now < proof.expiresAt,
                 (strict) proof.soterCounter > soterCounter[proof.bindingHash] → binding, counter
    SET_AGENT_KEY: agentKey == kya[account].agentKey (only the TEE key the bank verified)

scheduleRecovery(OwnerAction a /*SET_OWNER_KEY*/, bytes payload, bytes[] bankSigs)
    bank alone, after its own re-KYC; consumes usedDigest; recovery pending ⇒ account treated as RESTRICTED (A7)
    executableAt = now + 48 h ; emit RecoveryScheduled
executeRecovery(account)   anyone after executableAt if not cancelled: replaces all owner keys with the new one,
                           clears binding, pending moduleApprovals and approvals, revokes the agent key; emit RecoveryExecuted
CANCEL_RECOVERY via applyOwnerAction (owner alone)
```

### Views
`statusOf(account) → (effective, accountStatus, globalStatus, heartbeatValidUntil)`, `policyOf`, `policyHashOf`, `spentOf(account) → (day, month, count, rebalances)`, `kyaOf`, `capsOf(profile)`, `assetOf`, `isSanctioned`, `isPayoutBlocked`, `approvalOf(account, callHash)`, `isDigestUsed`, `bindingOf`, `soterCounterOf`, `attesterOf`, `nonces(type, key)`, `members()`, `domainSeparator()`, `digest*` helpers for every type.

### Tests (Foundry)
- Unit per rule, and **each rule against its neighbour** (two failing conditions ⇒ the earlier reason wins).
- Fuzz: amounts incl. 2²⁵⁶−1 (`check()` never reverts), random targets/selectors (I2), random signer subsets, nonces incl. 2⁶⁴−1 (I3, I18), approval replay and re-registration (I5), SOTER counters (I6), non-canonical batch encodings.
- Invariants (handler-based): bank caps never exceeded (I8); nothing leaves while FROZEN (I14); bands (I15); spent counters equal the sum of allowed payments.
- Fork tests on the real Safe7579 adapter + launchpad: the creation path of 00; I1 (`execTransaction` impossible, uninstall without MODULE_CHANGE refused); **I16** (USDC `permit` and `transferWithAuthorization` with any account signature fail); **I17** (enumerate every non-view selector of the deployed adapter ABI: hooked or unreachable); PasskeyValidator first op; agent op via AgentKeyValidator; refused op lands with `success=false`.
- Gas report (`forge snapshot`), compared to the reference: refused op ≈146k, RefusalLog ≈27.5k, WebAuthn ≈49k.

## StandingOrders (ERC-7579 executor, type 2)

```
storage  orders[account][id] = {payee, amount, period, nextDue, rail, merchantRef, active}
set(StandingOrder o) / cancel(account, id)          only MandateHook
execute(address account, uint32 id)                 anyone (agent, scheduler, judge…): pays exactly `amount`
    require active, now ≥ nextDue
    periodIndex = (now - firstDue) / period ; nextDue = firstDue + period * (periodIndex + 1)   (missed periods are skipped, never backlogged)
    USDC_DIRECT: account.executeFromExecutor(single, USDC.transfer(payee, amount))
    rails:       account.executeFromExecutor(batch, [USDC.approve(rail, amount), rail.pay(payee, amount, rail, merchantRef, paymentRef)])
    paymentRef = keccak256(abi.encode(account, id, periodIndex))
    emit StandingOrderExecuted(account, id, amount, periodIndex, msg.sender)
```
Stores no personal data (I19): payee address, amount, period, rail and `merchantRef` hash only; labels live off-chain.
Tests: twice in one period fails; after a long gap only one payment; anyone can trigger, nobody can change the amount; hook refusals (FROZEN, sanctioned, jurisdiction, partner suspended, bank cap, policy expired).

## PayoutRail

```
pay(address partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)   msg.sender = account; rail ≠ USDC_DIRECT
    require hook.assetOf(partner) is ACTIVE PAYOUT_PARTNER; USDC.transferFrom(account → rail, amount); id++; emit PayoutRequested
withdraw(id)                        only that partner: USDC to partner
settle(id, bytes32 settlementRef)   only that partner: emit PayoutSettled
fail(id, bytes32 code)              only that partner, only before withdraw: refund to account; emit PayoutFailed
```

## PriceOracle

```
feeds: tXAU → XAU/USD, tXAG → XAG/USD; USDC fixed 1e8
setPrice(token, int256 price8, uint64 publishTime, uint8 source)   only feeder
    price8 > 0; last.publishTime ≤ publishTime ≤ block.timestamp; |Δ| ≤ maxDeviationBps (2500) per update
getPrice(token) view → (price8, publishTime)
maxPriceAge (default 4 days): set by the owner = the deployer at deploy, then transferred to the bank's desk-operator key
```

## TreasuryDesk

```
swap(tokenIn, tokenOut, amountIn, minOut) → amountOut          the only way the desk moves anyone's tokens: from msg.sender
    one side USDC, other side tXAU or tXAG; oracle fresh
    USDC → metal: USDC.transferFrom(sender, desk); amountOut at price × (1 + spreadBps); mint metal to sender
    metal → USDC: metal.transferFrom(sender, desk) then burn the desk's own balance; pay USDC at price × (1 − spreadBps)
    amountOut ≥ minOut; sender verified in the IdentityRegistry
owner (desk operator = bank): setSpread, withdrawReserve, pause
```

## tXAU, tXAG (our ERC-3643)

Own implementation of the ERC-3643 interfaces (`IERC3643`, `IIdentityRegistry`, `ICompliance`). Never copy T-REX.
```
Token: ERC-20 (18 dp) + identityRegistry + compliance + roles (owner, agent)
  agent: mint, burn, setAddressFrozen, freezePartialTokens, forcedTransfer, recoveryAddress, pause/unpause
     (the desk holds the agent role only for mint; the bank's agent key holds the rest: known risk, 08)
  transfer/transferFrom: not paused; neither side frozen; free balance ≥ amount; both isVerified; compliance.canTransfer
IdentityRegistry: registerIdentity(wallet, identityHash = kycCredentialHash, country), deleteIdentity, isVerified(wallet)
  (deviation from ERC-3643, documented: no ONCHAINID claims; the bank registers a WeIdentity credential hash instead)
Compliance: country allowlist, only verified holders; desk and PayoutRail registered as verified
```

## RefusalLog

```
log(bytes32 userOpHash, address account, address target, uint256 value, bytes data)
    (reason, tier, callHash) = hook.check(account, target, value, data)   // computed on-chain (I11)
    require(reason != OK) ; emit Refused(userOpHash, account, callHash, reason, tier, target, msg.sender)
logBatch(bytes32 userOpHash, address account, Execution[] calls)  → first refused call
```
The link to `userOpHash` is claimed by the reporter; the reason is not. The bundler logs right after the failed op (documented caveat).

## Anchor

Stores its own `seq`. `anchor(AnchorAttestation a, bytes[] sigs)`: 2 member sigs (members read from the hook), `seq == stored + 1`, emit Anchored. `latest()`, `headAt(seq)`.

## PraetorPaymaster (own verifying paymaster, ERC-4337 v0.7)

```
paymasterAndData = paymaster(20) | paymasterVerificationGasLimit(16) | paymasterPostOpGasLimit(16) | validUntil(6) | validAfter(6) | sig(65)
sig over keccak256(abi.encode(sender, nonce, keccak256(initCode), keccak256(callData), accountGasLimits, preVerificationGas,
                              gasFees, keccak256(paymasterAndData[:84]), block.chainid, address(this)))
```
Returns `packValidationData(sigFailed, validUntil, validAfter)`. The bundler signs only for accounts registered in the api database **and** (`isInitialized` or our own launchpad init op): `isInitialized` alone is not enough, anyone can install the hook on their own contract. Written from the spec (never copy eth-infinitism's GPL `VerifyingPaymaster.sol`).

## WeCrossInbox (+ patched WeCrossProxy)

WeCross delivers to `string[] f(string[] args)` methods. `WeCrossInbox.deliver(string[] args) returns (string[])`: `args[0]` = message type (`Status`, `Heartbeat`, `Caps`, `KYA`, `Asset`, `Sanctions`, `Jurisdiction`, `Attester`, `Anchor`), `args[1]` = hex of `abi.encode(attestation, bytes[] sigs)`. Calls the matching `apply*` / `Anchor.anchor`; returns `["ok", <id>]` or `["error", <reason>]` (never reverts the router call). Permissionless.
The BCOS3 WeCrossProxy resolves paths through FISCO's BFS precompile, which doesn't exist on Base: deploy an **EVM-patched WeCrossProxy** (path → address map set by the deployer; Apache-2.0 header kept, patch logged in NOTICE). WeCrossHub isn't needed on Base (interchain requests originate on FISCO).
