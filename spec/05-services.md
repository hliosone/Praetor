# 05 · Services

> **Changed in Phase B (2026-10-17, DECISIONS D12, D15).** OpenCode tool lockdown: `"permission": {"*": "ask", "praetor_*": "allow"}` with agent-runner rejecting every permission request at once (the free tier answers 403 to `tools: {"*": false}`, V6); the per-account directory holds only its `opencode.json`. The FISCO status function is `AgentStatus.openStatus` (spec 04), not `proposeStatus`.


All services: TypeScript on Node 22, pnpm workspace package under `services/<name>`, Express (reuse from BSA Sentry), `zod` for every request body, `pino` logs (PII redaction list applied globally), `vitest` tests, one Dockerfile per service, config **only** from env (see 11). Every service exposes `GET /health` (checks its dependencies) and `GET /version`. Internal services listen only on the Docker network; Caddy is the only public entry.

Shared packages:
- `packages/protocol`: types, hashing, vectors (02).
- `packages/chain`: viem clients for Base (fork/live) with receipt-block reads and lag handling (from Alex's `services/relayer/base.mjs`), FISCO client with all quirks (legacy tx, gasPrice 0, getLogs with `toBlock − fromBlock ≤ 9`, ms timestamps; from Alex's `services/relayer/fisco.mjs`), contract ABIs generated from Foundry `out/` at build time, `deployments/<env>.json` loader, and `baseNow()` = latest Base block timestamp (the only clock for deadlines and expiries).
- `packages/userop`: our own Safe7579 + NoOwner account adapter (counterfactual address, launchpad initHash, init callData of 00) and build/hash/pack/sign/send for ERC-4337 v0.7 userOps (nonce key = `uint192(uint160(validator)) << 32`), from Alex's `sendUserOp`. Gas: simulate, then limits × 1.3 (never a fixed `callGasLimit`; minimum 300k).
- `packages/db`: drizzle schema + migrations per service database.
- `packages/ui-tokens`: colours, type, spacing shared by web app and mini program.

---

## api (public: `/api`, `/mp`, `/wechat`, `/push`, `/ws`)

The backend for the web app, the mini program and the consoles. Untrusted for safety: it prepares, relays and displays; every authority check is on-chain or in a member service.

Auth:
- Web: passkey login (WebAuthn, `@simplewebauthn/server`, rpID = `PUBLIC_HOST`), httpOnly session cookie, CSRF token on POST.
- Mini program: `wx.login` code → `code2Session` (the api also holds `MP_SECRET` for this; it gives read access only) → session token bound to the account linked with that openid. The attester does its own code2Session inside the TEE for approvals.
- Console: the api is only a pipe. Each **member service verifies its own staff passkey assertion over the exact attestation digest** before signing anything (staff passkeys registered in each member service, not in the api), so a compromised api can't make two members sign a loosening.

Endpoints (request/response schemas live in `packages/api-schema`, shared with the clients):
```
POST /api/onboarding/start                      → {userId}
POST /api/onboarding/passkey/options|verify     → passkey created; account address computed (counterfactual)
POST /api/onboarding/account/deploy             → prepares the launchpad userOp; client signs userOpHash with the passkey; → {txHash}
POST /api/onboarding/kyc/start {method: "vendor"|"eudi"} → redirect URL (kyc-vendor-mock or EUDI request QR)
GET  /api/onboarding/kyc/status
POST /api/onboarding/suitability {answers}      → riskProfile (scored by bank-service)
POST /api/onboarding/agent/create               → agent address + attestation summary + agent WeID
POST /api/onboarding/kya/sign {credentialDraft} → user signs AgentMandate (passkey over its hash); bank countersigns
POST /api/onboarding/wechat/link-token          → one-time token shown as QR (F2)
GET  /api/me, /api/portfolio, /api/prices, /api/status, /api/activity?cursor, /api/agent
GET  /api/policy ; POST /api/policy/propose {policy} → {ownerAction, digest, fiscoCheck} ; POST /api/owner-actions/submit {ownerAction, payload, auth}
GET  /api/approvals?state=pending ; GET /api/approvals/:id (full call details + digest preimage)
POST /api/approvals/:id/passkey {assertion}     → normalises low-s, submits registerApproval via bundler, resubmits the call
POST /api/approvals/:id/soter {code, resultJSON, resultJSONSignature, authMode} → soter-attester → registerApproval → resubmit
POST /api/approvals/:id/reject
GET  /api/standing-orders ; POST /api/standing-orders/propose → OwnerAction ; POST /api/standing-orders/:id/trigger
POST /api/agent/chat {message} → streams the agent's answer (SSE)
GET  /api/audit?from&to ; GET /api/audit/verify → recomputed chain head vs FISCO head vs latest Base anchor
GET  /api/statements/camt053?from&to → XML (ISO 20022 camt.053.001.02), validated against the XSD before sending
POST /api/sandbox/* (judges' sandbox; see 07), only when SANDBOX_ENABLED
/mp/* same reads + approvals for the mini program (JSON only)
POST /wechat/callback (Official Account: signature check from Alex's wechat.js, text commands "status", "balance", "agent <msg>")
POST /push/subscribe (VAPID web push)
WS   /ws (portfolio, approvals, status, decisions; auth by session)
```
Data (db `api`): users, passkeys (credential id, public key x/y), accounts, sessions, approval requests `{id, account, call, callHash, tier2Approval, digest, state, expiresAt, channel}`, push subscriptions, link tokens, sandbox accounts. **No KYC data.**

"What you see is what you sign": `/api/approvals/:id` returns the full preimage (target, value, data, account, nonce, expiresAt). The web app and the mini program **decode the calldata themselves**, show the full payee address (names from the api are labels, not truth), **recompute the digest locally** from what they display, and refuse to sign if it differs.

## bundler (internal)

Our own ERC-4337 bundler (no Pimlico), from Alex's proven `sendUserOp`.
```
POST /userop {userOp, validator: "agent"|"passkey"}
    1. paymaster signs sponsorship (only registered accounts or our launchpad init)
    2. simulate: MandateHook.checkBatch for every call → reasons
    3. submit handleOps (bundler EOA), wait for receipt, read UserOperationEvent
    4. success=false and a refusal was simulated → RefusalLog.log/logBatch (reason computed on-chain)
    → {userOpHash, txHash, success, reasons[], refusalLogTx}
POST /tx {to, data}            plain txs from the bundler EOA: registerApproval, applyOwnerAction, apply*, anchor, StandingOrders.execute
GET  /userop/:hash
```
Rules: gas from simulation × 1.3 (min `callGasLimit` 300k); serialise bundler EOA nonces; sponsor only accounts registered in the api DB **and** initialized (or our own launchpad init op); rate-limit refused userOps per account (20/day) and per agent key; alert when the bundler EOA balance or paymaster deposit is low; `skipRefused=false` by default (evidence on-chain), `true` for the sandbox spam guard.

## agent-signer (TEE, Phala CVM; local: dstack simulator)

```
GET  /v1/info                         → {appId, composeHash, simulator: bool, version}
GET  /v1/agents/:account/address?v=1  → address of getKey("praetor/agent/" + account + "/v" + keyVersion, "agent", "secp256k1")
POST /v1/agents/:account/attest {nonce, keyVersion} → {address, quote}  (reportData = keccak256(address ‖ nonce))
POST /v1/agents/:account/sign-userop {packedUserOp, chainId, entryPoint, keyVersion}
      computes userOpHash itself; refuses unless callData selector == execute and sender == account;
      rate limit 120/hour/account; → {signature}
POST /v1/agents/:account/sign-weid {kind: "createDid" | "addService", fields, keyVersion}  builds the WeIdentity payload inside and signs it
```
Auth: HMAC per caller (injected as Phala encrypted env). `sign-userop`: **mcp only**. `sign-weid`: bank-service only. `address`/`attest`: api and bank-service. No route exports a key. (A compromised mcp can therefore act inside the T1 mandate, like a leaked agent key: listed in the risks.) `@phala/dstack-sdk@0.5.8` (`DstackClient`, `getKey`, `getQuote`). Tests: same container against the simulator; key derivation stable across restarts; refuses non-execute callData; HMAC required.

## soter-attester (TEE, Phala CVM; local: dstack simulator)

```
GET  /v1/info                         → {attester address, appId, composeHash, simulator}
POST /v1/attest {nonce}               → quote with reportData = keccak256(attester ‖ nonce)
POST /v1/soter/approve {code, account, digestHex, expiresAt, authMode, resultJSON, resultJSONSignature}
   1. code2Session(MP_APPID, MP_SECRET) inside the enclave → openid
   2. stable_token (cached) → verify_signature(openid, resultJSON, signature) → require is_ok === true
   3. parse resultJSON by field name: raw === digestHex (64 lowercase hex), counter, uid, cpu_id
   4. bindingHash = keccak(appIdHash, openidHash, uidHash, cpuIdHash)
   5. sign SoterApproval{account, digest, bindingHash, soterCounter: counter, expiresAt}
   → {soterApproval, attesterSig}
```
TLS to `api.weixin.qq.com` terminates inside the CVM (Node's HTTPS with the system CA bundle pinned in the image). Never logs openid, uid, cpu_id or resultJSON. Reuse Alex's `services/approvals/soter/server/server.js` calls (stable_token, code2Session, verify_signature) and his captured iOS payload shapes as fixtures (identifiers scrubbed).

## mcp (public: `/mcp`, `/oauth`, `/.well-known/*`)

Reuse BSA Sentry `apps/server/src/{mcp,oauth,auth}.ts` (MCP over streamable HTTP, OAuth 2.1 with metadata discovery, dynamic client registration, PKCE; tested with claude.ai). Every token is bound to **one account**; tools take **no account parameter**.
```
get_portfolio()            balances, USD values, weights vs bands, prices (+ "demo price" flag)
get_mandate()              policy in plain words + caps + tier thresholds
get_status()               effective status, heartbeat, pause, KYA validity
get_activity(limit)        recent decisions with tx links and reasons
explain(action)            dry-run: hook.check() for a proposed pay/rebalance → reason + tier, no tx
rebalance(sell, buy, amountUsd)   builds [approve, desk.swap] with minOut from oracle and slippage → agent-signer → bundler
pay(payee | merchant, amount, memo)  builds USDC.transfer or [approve, rail.pay] → agent-signer → bundler;
                           T2 ⇒ creates an approval request and returns "waiting for the owner" with the request id
get_approval(id)           state of a request
propose_standing_order(payee, amount, period, rail, merchant) → creates a pending owner request only (never on-chain)
trigger_standing_order(id) → StandingOrders.execute when due
```
Our own agent connects with a static per-account bearer token (OpenCode `headers`), external agents through OAuth. Tool results never include KYC data (I9 test greps tool outputs for seeded PII).

## agent (OpenCode)

- Container with `opencode-ai` (exact version pinned in Phase 0) and a small **agent-runner** (Node) that starts one `opencode serve` per active account on its own port with its own `opencode.json` (MCP remote URL = `http://mcp:<port>/mcp`, header `Authorization: Bearer {env:…}` for that account's token), and stops it after 30 min idle. Basic auth on each server (`OPENCODE_SERVER_PASSWORD`).
- Config: model from env (`AGENT_MODEL=opencode/deepseek-v4.1-flash-free`), **every built-in tool disabled** (`"tools": {"*": false}`, then only the Praetor MCP tools enabled; `read`/`grep`/`list` could otherwise read the token in `opencode.json`). agent-runner writes each account's config and token into a per-account directory (sandbox accounts are created dynamically). `AGENTS.md` system prompt: role, the mandate, "never move money except through tools", "a T2 verdict (owner approval needed) means submit so the approval request is created; only a T0 refusal is final", answer in the user's language (EN/中文).
- agent-runner API (internal): `POST /wake {account, reason, context}` (scheduler), `POST /chat {account, message}` → SSE stream (api). Uses OpenCode's HTTP API (`POST /session`, `POST /session/:id/message`, `GET /global/event`).
- Tests: in the automated build tests only, a fake LLM provider (OpenCode supports custom OpenAI-compatible providers) replays scripted tool calls so flows are deterministic. Everything else (product, demo, live suite, red team) uses the real model.

## scheduler (internal)

```
every PRICE_CHECK_INTERVAL_S (prod 900, local 30) and immediately on PriceUpdated(source = DEMO): read balances + prices (multicall, free)
    for every active account; if any asset outside its band and rebalances today < max → agent-runner /wake {reason: "BAND", weights, bands}
every 60 s: StandingOrders due (nextDue ≤ baseNow) → POST /tx StandingOrders.execute(account, id)
every 60 s: expire approval requests; notify on expiry
```
Holds no key with power (uses the bundler's /tx). Idempotent (a second instance can't double-pay: the executor's nextDue prevents it).

## oracle-feeder (internal)

Every 60 s: Hermes `GET /v2/updates/price/latest?ids[]=0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2&ids[]=0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e` (`Authorization: Bearer $PYTH_API_KEY`) → normalise to 8 decimals → if moved > 0.2% or older than 30 min → `PriceOracle.setPrice(token, price8, publishTime, PYTH)` (publishTime capped at the Base block time). CLI `scripts/demo/shock.ts --asset XAU --pct 20` → `setPrice(..., DEMO)` and a demo hold of `DEMO_HOLD_S` (600) during which Pyth updates for that asset are skipped. The UI shows "demo price" whenever the last update's source is DEMO. Weekend: prices stay at Friday close (within `maxPriceAge`).

## bank-service (member: bank)

Keys: bank FISCO account, bank Base signer, desk operator / token agent, recovery guardian. DB `bank` (KYC records encrypted at rest: SM4-GCM in the Guomi profile, AES-256-GCM otherwise; key from env).
```
KYC:      POST /kyc/sessions (from api) → kyc-vendor-mock or EUDI (reuse BSA Sentry apps/server/src/age/eudiw.ts: OpenID4VP,
          age_over_18 + issuing country) ; callback → sanctions name screening (mock list) → PersonKYC credential issued (identity)
Suitability: POST /suitability {answers} → riskProfile (5 questions, documented scoring)
KYA:      POST /kya {account, agentAddress, quote, nonce, mandateDraft} → verify quote (prod: Phala verify API
          POST https://cloud-api.phala.com/api/v1/attestations/verify + RTMR3 compose-hash allowlist; local: simulator accepted only
          if ATTESTATION_MODE=simulator) → AgentMandate countersigned (identity) → MandateRegistry.recordKYA → KYAAttestation signed
Policy:   POST /policy/check {account, policy} → MandateRegistry.submitPolicy → if ok, sign OwnerAction(SET_POLICY) → {bankSig, fiscoRef}
Owner actions: POST /owner-actions/cosign {ownerAction, payload} → rule-specific checks → record on FISCO → bankSig
Tokens:   on KYA: IdentityRegistry.registerIdentity(account, kycCredentialHash, country); revoke on KYC revoke
Caps/assets/attesters: console endpoints → FISCO proposals (+ signatures)
Recovery: bank-service runs the re-KYC itself (kyc-vendor-mock or EUDI), requires the result to match the stored PersonKYC hash, notifies the user **through its own channel** (its own OA credentials and email, not the api/notifier) → scheduleRecovery (48 h, account RESTRICTED meanwhile)
```

## regulator-service (member: regulator)

Keys: regulator FISCO account, regulator Base signer. Console endpoints: `POST /status {account|global, status}` (sign + AgentStatus.proposeStatus), `POST /status/:nonce/cosign`, `POST /sanctions`, `POST /jurisdictions`, `GET /agents` (all accounts with status, KYA, last decisions, refusals).

## operator-service (member: operator)

Keys: operator FISCO account, operator Base signer. Jobs: heartbeat every `HEARTBEAT_INTERVAL_S` (prod 300, validUntil = baseNow + `HEARTBEAT_TTL_S` = 900); **audit writer** (subscribes to Base events of 02 and FISCO Ready events → builds AuditEntry JSON → stores in db `operator` → `AuditLog.append`); anchor proposer every 20 entries or hourly (signs, asks a second member to co-sign via its service API, then the bridge delivers). Exposes `GET /audit/entries`, `GET /audit/head`.

## bridge-relayer (internal)

Watches `BaseOutbox` (chunked getLogs). `BRIDGE=relayer`: delivers every pending message to Base via bundler `/tx` (calls `MandateHook.apply*` / `Anchor.anchor`), then `markDelivered`. `BRIDGE=wecross`: watchdog only: delivers anything WeCross hasn't delivered within `BRIDGE_WATCHDOG_S` (default 120 s) and logs it as a WeCross failure.

## wecross (router + stubs)

- Router: WeCross **v1.4.0** (JDK 8, MySQL; dormant upstream since March 2024), official BCOS3 stub v1.4.0 for FISCO (`payment.fisco.*`, built on java-sdk 3.6.0: V4 checks it against 3.17.1), **our EVM stub** for Base (`payment.base.*`) targeting the patched WeCrossProxy of 03.
- `wecross/evm-stub`: Java 8, Gradle 6.x as WeCross requires, web3j 4.9.x. Implements `com.webank.wecross.stub` (`@Stub("EVM")` StubFactory, Driver, Connection, Account). Driver: `asyncCall`/`asyncSendTransaction` encode `WeCrossProxy.constantCall/sendTransaction` to the target resource, `asyncGetBlockNumber`, `asyncGetBlock`, `asyncGetTransaction`, `decodeTransactionRequest`, `getResources`; Connection: JSON-RPC over HTTP to Base (fork or live) with receipt polling; Account: secp256k1 from a key file. Interchain: the router polls `WeCrossHub` on FISCO, calls `payment.base.inbox.deliver(args)` on Base, then the callback `payment.fisco.outbox.onDelivered`.
- Tests: JUnit for the stub against anvil; integration: FISCO Ready(Status) → router → Base `StatusApplied` within 60 s; with the router stopped, the relayer watchdog delivers.

## identity (WeIdentity)

- `weid-rest`: WeIdentity REST Service (versions from Alex's spike), container, Docker network only (no auth, custodial keys).
- `weid-helper`: Java (from Alex's `services/identity/java/Scenario.java`), small HTTP API for what REST lacks: `addSignature` (multi-signed AgentMandate), selective disclosure, evidence create/get, revocation check (verify ignores revocation, so verification = signature check **and** evidence not revoked **and** not expired).
- `packages/weid-client` (TS, from Alex's `weid-client.mjs`): checks `errorCode` on every call (errors come back as success), trusts "recognized" only after a read-back.
- CPTs: `PersonKYC {ageOver18: bool, jurisdiction: string, riskProfile: enum, sanctionsScreened: date, kycLevel: int}`, `AgentMandate {principal: WeID, wallet: "eip155:84532:<account>", agentKey: address, scopes: ["rebalance","pay","standing_orders"], mandateHash, riskProfile, agentMeasurement}`.
- Agent DID document services: `AgentWallet` = `eip155:84532:<account>`, `MCP` = `https://<host>/mcp`.

## kyc-vendor-mock (public: `/kyc-mock`)

Hosted-flow imitation, clearly labelled "Demo KYC provider": ID document photo upload (any image; MRZ fields typed), selfie with a camera capture and a scripted "turn your head" liveness check, name screening against a mock list. Result posted to bank-service with HMAC. Images deleted after the decision; only the decision and hashes kept.

## notifier (internal)

Notification policy (per user, set in Settings; default in bold):
| Event | When | Channels |
|---|---|---|
| T2 approval needed, owner action to confirm | Immediately, always | WeChat OA + mini program badge + web push |
| Refusal T0 (sanctions, hard cap, hidden call…), FROZEN/RESTRICTED, recovery scheduled | Immediately, always | Same |
| T1 actions done by the agent (rebalance, payment, standing order, payout settled) | **Immediately, one message per action** · or daily digest at 20:00 · or digest only | WeChat OA (+ push if enabled); always visible in the feed |
| Heartbeat stale, price stale | In the feed and the daily digest only | Feed |
Volume stays low by construction: at most `maxRebalancesPerDay` rebalances (1 in the demo), payments only within the auto cap and the daily count, standing orders once per period.

- WeChat Official Account test account: customer-service / template messages ("Agent sold 650 USD of gold: band 36% > 35%", "Approve 300 USDC to Café Lumen?", "Approved ✓ tx …", "Agent frozen by the regulator"). Test-account messages can't open the mini program directly: the message tells the user to open it, or links the web approval page.
- Web Push (VAPID, `web-push`), for the installed web app (iOS 16.4+ home screen, Android with Google services).
- WebSocket fan-out to open mini programs and web apps.

## payout-partner (mock PSP) + alipayplus-mock + wechatpay-mock

- payout-partner watches `PayoutRequested`, looks up the merchant (`merchantRef` → merchant record), and for Alipay+ runs the **official MCP server** `ant-intl-alipayplus-mcp` (MIT, stdio, `uvx`) as a client with `GATEWAY_URL=http://alipayplus-mock:…`, calling `create_payment` (minor units) then `query_payment`; for WeChat Pay calls wechatpay-mock. On success: `PayoutRail.withdraw` + `settle(id, settlementRef)`; on failure `fail(id, code)` (refund). Keys: payout partner key.
- alipayplus-mock: implements the Alipay+ ACQP HTTP endpoints and request signing that the MCP server uses (Phase 0 reads `src/alipayplusmcp/*.py` for exact paths and the RSA signature header format), with test keys; scripted outcomes (success, pending → success, failure).
- wechatpay-mock: minimal JSAPI-like order + query.
- Everything here is labelled **mock** in the UI and docs.

## webase-front (explorer)

WeBASE-Front version compatible with FISCO 3.17.1 (Phase 0 confirms; Alex's notes list WeBASE 3.0.2 as the documented pairing). Behind the console's auth at `/explorer`, read-only.
