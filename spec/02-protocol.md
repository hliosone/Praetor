# 02 · Protocol (the shared interface)

`packages/protocol` is the contract between every component. It exists twice, **TypeScript** (`src/index.ts`) and **Solidity** (`sol/PraetorTypes.sol`), and both are tested against the same golden vectors (`vectors/*.json`). Once green it is **frozen**: any change updates TS + Solidity + vectors + both test suites in one commit, and is logged in `docs/DECISIONS.md`.

Start from Alex's `packages/protocol` (parity check and vector generator are proven) and replace its types with the ones below. Note: Alex's callHash included a nonce and expiry; ours doesn't (they live in the approval), see "Replay model".

## Units

| Quantity | Unit |
|---|---|
| USDC amounts, caps, budgets, USD values | 6 decimals (1 USD = 1_000_000) |
| tXAU, tXAG amounts | 18 decimals, 1 token = 1 troy ounce |
| Prices (`PriceOracle`) | USD per whole token, 8 decimals (Pyth normalised to expo −8). USDC is pinned at 1e8. |
| `valueUsd6(token, amount)` | `amount * price8 / 10**(decimals + 2)`; amounts > 2¹²⁸ are refused before any arithmetic (INVALID_AMOUNT) |
| Basis points | 10_000 = 100% |
| Time on Base | seconds (`block.timestamp`). **Services derive every Base-bound time (deadline, expiresAt) from the latest Base block timestamp, never from the wall clock** (the fork's clock moves with time warps). |
| Time on FISCO | **milliseconds** in contracts. Every attestation carries **seconds**; FISCO contracts convert. |
| Day / month buckets | `day = timestamp / 86400`, `month = timestamp / (30 * 86400)`: fixed 30-day epochs (a user can spend up to two monthly budgets across an epoch boundary; documented) |

## EIP-712 domain

`{ name: <DOMAIN_NAME>, version: "1", chainId: 84532, verifyingContract: <MandateHook address> }`

`DOMAIN_NAME` = `"Praetor"` on live Base Sepolia, `"Praetor-local"` on the anvil fork, `"Praetor-sandbox"` for the sandbox deployment (00). The chainId is the **constant 84532** everywhere, including in FISCO contracts and member services (never `block.chainid`, which is 20200 on FISCO; never OpenZeppelin's `EIP712` base on FISCO). FISCO contracts read `baseHook` and `domainName` from `MemberRegistry` (settable by 2 of 3 members), so local and live can share code. Unit tests use `verifyingContract = 0x00000000000000000000000000000000DeaDBeef`, name `"Praetor-test"`.

## Enums (uint8 on the wire; order = value)

```
Status        ACTIVE=0 RESTRICTED=1 FROZEN=2                  (higher = stricter)
RiskProfile   NONE=0 CONSERVATIVE=1 BALANCED=2 GROWTH=3
AssetKind     TOKEN=0 DESK=1 PAYOUT_PARTNER=2
AssetStatus   NONE=0 ACTIVE=1 SUSPENDED=2 DELISTED=3          (SUSPENDED: no buys, sells allowed; DELISTED: no trades)
Rail          USDC_DIRECT=0 ALIPAY_PLUS=1 WECHAT_PAY=2
Tier          T0_NEVER=0 T1_AUTONOMOUS=1 T2_HUMAN=2 T3_OWNER=3 T4_CONSORTIUM=4
AuthKind      PASSKEY=0 SOTER=1
PriceSource   PYTH=0 DEMO=1
```

### OwnerActionKind: payload and payloadHash (exact)

`payloadHash = keccak256(payload)` unless stated otherwise.

| # | Kind | Who | `payload` bytes | `payloadHash` | Effect |
|---|---|---|---|---|---|
| 0 | SET_POLICY | owner + bank | `abi.encode(Policy)` | keccak256(payload) (= policyHash) | store policy |
| 1 | ADD_STANDING_ORDER | owner + bank | `abi.encode(StandingOrder)`; `order.account == a.account` | `hashStruct(StandingOrder)` (EIP-712 struct hash) | `StandingOrders.set` |
| 2 | CANCEL_STANDING_ORDER | owner alone | `abi.encode(uint32 id)` | keccak256(payload) | `StandingOrders.cancel` |
| 3 | LINK_WECHAT | passkey + SOTER proof + bank | `abi.encode(bytes32 linkNonce, SoterApproval proof, bytes attesterSig)` | `keccak256(abi.encode(linkNonce))` | binding = proof.bindingHash |
| 4 | UNLINK_WECHAT | owner alone | `abi.encode(bytes32 bindingHash)` | keccak256(payload) | binding = 0 |
| 5 | SET_AGENT_KEY | owner + bank | `abi.encode(address agentKey, uint48 validUntil)`; `agentKey == kya[account].agentKey`; `now < validUntil` | keccak256(payload) | `AgentKeyValidator.setKey` |
| 6 | REVOKE_AGENT_KEY | owner alone | `abi.encode(address agentKey)` | keccak256(payload) | `AgentKeyValidator.revoke` |
| 7 | PAUSE_AGENT | owner alone | `0x` | `bytes32(0)` | paused = true |
| 8 | RESUME_AGENT | owner alone | `0x` | `bytes32(0)` | paused = false (only the owner's own pause) |
| 9 | SET_OWNER_KEY | owner + bank (passkey only, never SOTER) | `abi.encode(bytes32 credIdHash, uint256 x, uint256 y)`; x = y = 0 removes that key; ≤ 4 keys; can't remove the last one | keccak256(payload) | `PasskeyValidator.setKey` |
| 10 | CANCEL_RECOVERY | owner alone | `abi.encode(bytes32 recoveryPayloadHash)` | keccak256(payload) | cancel pending recovery |
| 11 | MODULE_CHANGE | owner + bank | the exact `installModule`/`uninstallModule` calldata | `callHash(account, 84532, account, 0, payload)` | moduleApprovals[callHash] |
| 12 | REMOVE_PAYEE | owner alone | `abi.encode(address payee)` or `abi.encode(bytes32 merchantKey)` with a leading `uint8` tag (0 payee, 1 merchant) | keccak256(payload) | remove from the stored policy (policyHash updated, event) |

## Refusal reasons (final; order = wire value)

| # | Reason | Tier when it fires | Meaning |
|---|---|---|---|
| 0 | OK | – | Allowed |
| 1 | FROZEN | T0 | Account or global status FROZEN |
| 2 | RESTRICTED | T2 | Status RESTRICTED, owner pause, or recovery pending: no autonomous action |
| 3 | STALE_STATUS | T2 | Heartbeat expired; treated as RESTRICTED |
| 4 | SESSION_EXPIRED | T0 | Policy `validUntil` passed (agent key expiry is enforced by the validator, not here) |
| 5 | TARGET_NOT_ALLOWED | T0 | Target not modelled (default deny) |
| 6 | SELECTOR_NOT_ALLOWED | T0 | Known target, selector or pattern not allowed (e.g. `approve` outside the desk/rail pattern) |
| 7 | UNKNOWN_PAYEE | T2 | Payee or merchant not in the policy |
| 8 | OVER_AUTO_CAP | T2 | Above the policy's autonomous cap |
| 9 | OVER_HARD_CAP | T0 | Above the policy hard cap or the bank per-tx cap |
| 10 | BUDGET_EXCEEDED | T2 / T0 | Over the user's daily/monthly budget (T2) or the bank's daily/monthly cap (T0) |
| 11 | COUNT_EXCEEDED | T2 | Over the daily payment count |
| 12 | BAND_BREACH | T2 / T0 | Projected allocation leaves a user band without moving closer to target (T2), or exceeds the bank's maxWeight (T0) |
| 13 | BUFFER_BREACH | T2 | USDC would fall below the buffer |
| 14 | TIER2_REQUIRED | T2 | Generic "needs a human" (for callers that only want the tier) |
| 15 | TIER2_INVALID | T0 | Approval signature, digest reuse, expiry, binding, counter or attester invalid |
| 16 | ASSET_NOT_APPROVED | T0 | Token not ACTIVE (buy) / DELISTED (sell), or not in the policy bands |
| 17 | SANCTIONED | T0 | Payee, partner or counterparty on the sanctions list |
| 18 | JURISDICTION_BLOCKED | T0 | Stablecoin payouts not allowed for the user's jurisdiction (e.g. CN) |
| 19 | COUNTERPARTY_NOT_APPROVED | T0 | Desk or payout partner not ACTIVE |
| 20 | HIDDEN_CALL | T0 | delegatecall, non-zero ETH value, self-call, try-mode, non-canonical batch encoding, unknown selector |
| 21 | REBALANCE_LIMIT | T2 | Over `maxRebalancesPerDay` or `maxTradeUsd` |
| 22 | STALE_PRICE | T0 | Oracle price older than `maxPriceAge` |
| 23 | SLIPPAGE | T0 | `minOut` worse than oracle price − `maxSlippageBps` |
| 24 | KYA_INVALID | T0 | No valid KYA for the account (missing, expired, level 0) |
| 25 | NO_POLICY | T0 | No policy set yet |
| 26 | TIER3_REQUIRED | T3 | Module change without a matching owner action |
| 27 | INVALID_AMOUNT | T0 | Zero amount, or amount > 2¹²⁸ |

`check()` returns the **first** failing reason in the decision order of [03](03-contracts-base.md). For T2 reasons, a matching live approval turns the result into OK. `check()` never reverts on any input (no panics), so `RefusalLog` can always log.

## callHash

```
callHash = keccak256(abi.encode(address account, uint256 84532, address target, uint256 value, bytes32 keccak256(data)))
```
Batches: one callHash per call; each call needing T2 needs its own approval.

## Replay model

| Message | Rule |
|---|---|
| Consortium attestations (Status, Sanctions, Jurisdiction, Asset, Attester, Caps, KYA) | `nonce == stored + 1` per key (per account / target / jurisdiction / asset / attester / profile). **FISCO allocates the nonce** (the board contracts in 04); a member submitting directly must use it. Prevents a single member from jumping to 2⁶⁴−1 and blocking every later message (I18). |
| Heartbeat | `epoch == stored + 1` |
| Anchor | `seq == stored + 1` |
| Tier2Approval, OwnerAction | `nonce` = random uint64 salt; the hook stores `usedDigest[digest] = true` and refuses a reused digest. Concurrent pending requests stay valid. `expiresAt ≤ now + 1 hour`. |
| Approval slot | `approvals[account][callHash]` can be (re)registered when empty, consumed, or expired: identical payments can be approved again later. Same for `moduleApprovals`. |
| SoterApproval | single use through the digest it carries; `soterCounter` must exceed the stored counter for the binding when `SOTER_COUNTER_STRICT` (constructor flag, default true; set false if Phase C shows iOS doesn't increment it; the counter is then recorded, not enforced). `expiresAt ≤ now + 1 hour`. |

## fiscoRef

- T4 types (Status, Sanctions, Jurisdiction, Asset, Attester, Caps, KYA): `fiscoRef = keccak256(abi.encode(address fiscoContract, uint256 proposalId))`, where `proposalId` is allocated by FISCO in the proposal's first transaction (members sign after it exists).
- OwnerAction: for SET_POLICY, the hash of the `MandateChecked` FISCO tx (the check happens before anyone signs); otherwise `bytes32(0)`. `recordOwnerAction` on FISCO happens after signing and is not part of the digest.
- Anchor: none (`fiscoBlock` is in the struct).

## EIP-712 types (exact type strings; field order is part of the hash)

Consortium messages use `deadline` = latest time the message may be **submitted** to Base. Owner/human messages use `expiresAt`. All signature arrays are `bytes[] sigs`, signers distinct and sorted ascending by address.

```
StatusAttestation(address account,uint8 status,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  account = 0x0 for the global status. Tighten (status > current): 1 member sig. Same or looser: 2 distinct members.

HeartbeatAttestation(uint64 epoch,uint64 validUntil,uint64 deadline)
  1 member. validUntil ≤ now + 1 day.

CapsAttestation(uint8 riskProfile,uint256 perTxCap,uint256 dailyCap,uint256 monthlyCap,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  Bank only. Global per risk profile.

KYAAttestation(address account,address agentKey,bytes32 agentDidHash,bytes32 kycCredentialHash,bytes32 mandateCredentialHash,uint8 kycLevel,uint8 riskProfile,bytes2 jurisdiction,bytes32 agentMeasurement,uint64 validUntil,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  Bank only. kycLevel 0 = revoked. jurisdiction = ISO 3166-1 alpha-2 ("HK" = 0x484b). agentKey = the TEE key the bank verified.

AssetAttestation(address asset,uint8 kind,uint8 status,uint16 maxWeightBps,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  Any loosening component (activate, raise maxWeight, change kind) ⇒ bank. Only tightening (suspend, delist, lower) ⇒ any 1 member.

SanctionsAttestation(address target,bool listed,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  listed=true: 1 member. listed=false: 2 members.

JurisdictionAttestation(bytes2 jurisdiction,bool payoutBlocked,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  block: 1 member. unblock: 2 members.

AttesterAttestation(address attester,bytes32 measurement,bool active,uint64 nonce,uint64 deadline,bytes32 fiscoRef)
  activate: bank. deactivate: any 1 member.

AnchorAttestation(uint64 seq,bytes32 head,uint64 fiscoBlock,uint64 deadline)
  2 members.

Tier2Approval(address account,bytes32 callHash,uint64 nonce,uint64 expiresAt)

OwnerAction(address account,uint8 action,bytes32 payloadHash,uint64 nonce,uint64 expiresAt,bytes32 fiscoRef)

SoterApproval(address account,bytes32 digest,bytes32 bindingHash,uint64 soterCounter,uint64 expiresAt)
  Signed by an active attester. digest = EIP-712 digest of the Tier2Approval or OwnerAction being approved.
  The SOTER challenge shown on the phone is digest as 64 lowercase hex chars, no 0x.

StandingOrder(address account,uint32 id,address payee,uint256 amount,uint32 period,uint64 firstDue,uint8 rail,bytes32 merchantRef)
  Fixed amount per period. rail USDC_DIRECT: payee = recipient. ALIPAY_PLUS / WECHAT_PAY: payee = payout partner, merchantRef = merchant id hash.
```

### Owner auth encoding

```solidity
struct OwnerAuth { uint8 kind; bytes data; }
// PASSKEY: data = abi.encode(bytes32 credIdHash, WebAuthn.WebAuthnAuth)  ; challenge = abi.encodePacked(digest) (32 bytes)
// SOTER:   data = abi.encode(SoterApproval, bytes attesterSig)           ; requires policy.soterEnabled and a live binding
```
Passkey `s` must be low-s (normalise off-chain; iPhones return high-s about half the time). `requireUV = true`.

### bindingHash and merchant keys

```
bindingHash = keccak256(abi.encode(keccak256(bytes(mpAppId)), keccak256(bytes(openid)), keccak256(bytes(uid)), keccak256(bytes(cpu_id))))
merchantRef = keccak256(bytes(merchantId))
merchantKey = keccak256(abi.encode(address partner, bytes32 merchantRef))      // stored in Policy.merchants
```
`uid` and `cpu_id` come from SOTER's `resultJSON`. Raw identifiers never go on-chain or into logs.

## Policy encoding

```solidity
struct Band   { address token; uint16 minBps; uint16 targetBps; uint16 maxBps; }
struct Policy {
  uint256 autoCap; uint256 hardCap; uint256 dailyBudget; uint256 monthlyBudget; uint16 dailyCount;
  uint256 bufferUsdc;
  address[] payees;          // ≤ 16
  bytes32[] merchants;       // ≤ 16, merchantKey
  Band[] bands;              // ≤ 4, USDC first; Σ targetBps = 10_000; min ≤ target ≤ max
  uint8 maxRebalancesPerDay; uint256 maxTradeUsd; uint16 maxSlippageBps;
  uint64 validUntil;
  bool soterEnabled;
}
policyHash = keccak256(abi.encode(policy))
```
Validation (TS and Solidity, same vectors): `autoCap ≤ hardCap`, `dailyBudget ≤ monthlyBudget`, all amounts ≤ 2¹²⁸, bands consistent, no duplicate payees/merchants/tokens, `validUntil > now`.

## Events (Base)

```
MandateHook
  Decision(address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, uint256 valueUsd6)
  StatusApplied(address indexed account, uint8 status, uint64 nonce, bytes32 fiscoRef, uint8 signerCount)
  HeartbeatApplied(uint64 epoch, uint64 validUntil)
  CapsApplied(uint8 indexed riskProfile, uint256 perTxCap, uint256 dailyCap, uint256 monthlyCap, bytes32 fiscoRef)
  KYAApplied(address indexed account, address agentKey, uint8 kycLevel, uint8 riskProfile, bytes2 jurisdiction, uint64 validUntil, bytes32 fiscoRef)
  AssetApplied(address indexed asset, uint8 kind, uint8 status, uint16 maxWeightBps, bytes32 fiscoRef)
  SanctionsApplied(address indexed target, bool listed, bytes32 fiscoRef)
  JurisdictionApplied(bytes2 indexed jurisdiction, bool payoutBlocked, bytes32 fiscoRef)
  AttesterApplied(address indexed attester, bytes32 measurement, bool active)
  ApprovalRegistered(address indexed account, bytes32 indexed callHash, uint8 authKind, uint64 expiresAt)
  ApprovalConsumed(address indexed account, bytes32 indexed callHash)
  OwnerActionApplied(address indexed account, uint8 indexed action, bytes32 payloadHash, uint8 authKind, bytes32 digest)
  PolicySet(address indexed account, bytes32 policyHash)
  RecoveryScheduled(address indexed account, bytes32 payloadHash, uint64 executableAt) / RecoveryCancelled / RecoveryExecuted
RefusalLog
  Refused(bytes32 indexed userOpHash, address indexed account, bytes32 indexed callHash, uint8 reason, uint8 tier, address target, address reporter)
StandingOrders
  StandingOrderSet(address indexed account, uint32 indexed id, bytes32 orderHash) / StandingOrderCancelled(...)
  StandingOrderExecuted(address indexed account, uint32 indexed id, uint256 amount, uint64 periodIndex, address trigger)
PayoutRail
  PayoutRequested(uint256 indexed id, address indexed account, address indexed partner, uint256 amount, uint8 rail, bytes32 merchantRef, bytes32 paymentRef)
  PayoutSettled(uint256 indexed id, bytes32 settlementRef)  / PayoutFailed(uint256 indexed id, bytes32 code) (refund to account)
PriceOracle
  PriceUpdated(address indexed token, int256 price8, uint64 publishTime, uint8 source)
TreasuryDesk
  Swapped(address indexed account, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 price8)
Anchor
  Anchored(uint64 indexed seq, bytes32 head, uint64 fiscoBlock)
```
Error: `MandateRefused(uint8 reason, bytes32 callHash)`. Safe7579 replaces hook revert data with `ExecutionFailed()`; callers learn the reason through `check()`.

## Audit entry (off-chain JSON, hashed into FISCO AuditLog)

Keep Alex's `audit-entry.schema.json`, extended:
```
kind: DECISION | REFUSAL | APPROVAL | OWNER_ACTION | STATUS | HEARTBEAT | KYA | ASSET | SANCTIONS | JURISDICTION |
      CAPS | STANDING_ORDER | PAYOUT_REQUESTED | PAYOUT_SETTLED | REBALANCE | ANCHOR | KEY_ROTATION | RECOVERY
fields: seq, account, kind, reason, tier, callHash?, baseTx?, userOpHash?, fiscoTx?, payoutId?, paymentRef?,
        settlementRef?, merchantRef?, amountUsd6?, atMs, prevHead, entryHash
entryHash = keccak256(canonical JSON (RFC 8785) of the entry without entryHash)
head_n = keccak256(abi.encode(head_{n-1}, entryHash_n)), head_0 = 0x0
```

## Golden vectors

`vectors/<type>.json` for every type: inputs, encodeType string, typehash, structHash, digest (test domain), and signatures from fixed **test-only** keys (anvil default keys 1–4 as bank/regulator/operator/attester, **only in unit tests**, never as members of any deployment); a fixed P-256 test key for passkey vectors incl. one high-s case. Also: `callHash` cases, `policyHash` cases (valid and each invalid rule), `bindingHash`, `merchantKey`, OwnerAction payload/payloadHash per kind, audit chain of 5 entries, `valueUsd6` cases incl. the 2¹²⁸ bound. TS tests (vitest), Solidity tests (Foundry, `vm.readFile`) and the mini program bundle all assert against them. Generator: `vectors/make-vectors.ts` (start from Alex's `make-vectors.mjs`).
