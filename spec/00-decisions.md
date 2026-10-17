# 00 · Decisions

> **Changed in Phase B (2026-10-17, DECISIONS D8, D9).** Init batch order is `[setRegistry(0,[],0), installModule(2, StandingOrders), installModule(4, MandateHook)]` (the hook installed first refuses the executor install, V1). PasskeyValidator accepts only `execute` and `setupSafe`; module changes go through a single `execute(self.installModule/uninstallModule)` gated by a MODULE_CHANGE approval (spec 03 note).


Every line here is decided. Claude Code does not reopen them; if one turns out impossible, it applies the stated fallback, logs it in `docs/DECISIONS.md`, and continues.

## Scope: everything, nothing mocked except what is listed

Built for real: Base Sepolia contracts, own bundler and paymaster, Safe7579 account with our own validators and hook, FISCO BCOS 3.17.1 consortium (4 nodes), WeIdentity (DIDs, credentials, evidence, revocation), WeBASE explorer, WeCross router with the existing BCOS3 stub **and our new EVM stub**, two TEEs on Phala dstack (agent signer, SOTER attester), tokenized gold and silver (our own ERC-3643 implementation), treasury desk with a real price feed, standing orders, payout rail, MCP server with OAuth, OpenCode agent with DeepSeek, WeChat mini program with SOTER Face ID, WeChat Official Account bot, installable web app with passkeys and web push, consortium console (bank, regulator, operator), judges' sandbox, Guomi (SM2/SM3/SM4) profile for FISCO, ISO 20022 camt.053 export, Slither, Foundry fuzz and invariant tests, red-team suite, docs in English and Simplified Chinese.

Mocked, and labelled as mocks everywhere they appear:
- **KYC vendor** (ID document + selfie + sanctions screening). The EU Digital Identity Wallet path is real (reused from BSA Sentry).
- **Payout partner** (a licensed PSP) and the **Alipay+ / WeChat Pay gateways**. The payout partner runs the real `ant-intl-alipayplus-mcp` client against our mock Alipay+ gateway.
- **Gold and silver backing**: tXAU/tXAG are issued by the demo team and backed by nothing.
- **Consortium organisations**: the team runs all three members.

## Divergences from the reference repo (`ahuou/Praetor`): ours wins

| Topic | Reference repo | **Our decision** |
|---|---|---|
| SOTER power | "T2-S": small amounts only, `soterCap`, `OVER_SOTER_CAP`, never rule changes | SOTER approves **any payment up to the mandate's hard cap**. Rule changes: passkey + bank, **or SOTER + bank** on phones without passkeys. No `soterCap`, no `OVER_SOTER_CAP`. |
| SoterApproval fields | `{callHash, expiry}` | `{account, digest, bindingHash, soterCounter, expiresAt}`. Counter strictly increasing per binding, checked on-chain. Binding to WeChat account + phone. |
| Refusal reasons | Declared by the relayer (`RefusalLog.log(..., reason)`) | **Computed on-chain**: `RefusalLog` calls `MandateHook.check()` itself. |
| Protocol types | 7 types, several DRAFT | 13 types in [02-protocol.md](02-protocol.md), incl. Heartbeat, Asset, Sanctions, Jurisdiction, Caps per risk profile, OwnerAction, StandingOrder, Attester, Anchor (global). |
| Scope cuts ("SOTER only if time", no WeCross, no TEE, no tokens) | Cut | **All in.** |
| Repo | Walking skeleton with `flows/` stubs | **New repo**, built TDD from zero, reusing proven files listed in [09-repo-and-reuse.md](09-repo-and-reuse.md). |
| Mini program vs web | Web PWA first | **WeChat-first** (mini program is the daily UI) **and** the web app (owner actions with passkeys, desktop, judges, WeChat outage). |
| Consortium nodes | Native binaries on a laptop | Docker Compose, same files local and prod. |

## Chains

- **Base Sepolia** (chainId 84532): all money. EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`. Safe7579 adapter `0x7579EE8307284F293B1927136486880611F20002`, launchpad `0x7579011aB74c46090561ea277Ba79D510c6C00ff` (both proven by Alex). USDC = Circle's Base Sepolia USDC (6 decimals). Two modes: **fork** (anvil fork of Base Sepolia, free, used by tests) and **live** (real tx hashes for evidence).
- **FISCO BCOS 3.17.1**, Air version, **4 sealer nodes** (PBFT needs 3f+1 = 4 to survive one fault): bank, regulator, operator, operator-2. Governance (auth) mode, committee = bank, regulator, operator (chain governance only; our app-level 2-of-3 lives in our own `MemberRegistry`). The **main profile is non-SM** (secp256k1): all gates run on it. A **Guomi profile** (SM2/SM3/SM-TLS, `build_chain.sh -s`) is built and tested as an extra: in SM mode `keccak256` runs as SM3, so EIP-712 digests on FISCO no longer match Base; there our FISCO contracts store attestations and signatures as opaque bytes (Base still verifies everything), WeIdentity runs in SM mode, members prove their secp256k1 Base key with an SM2 signature, and an SDK smoke test passes. web3 RPC chainId 20200, group `group0`. Note: the operator runs 2 of the 4 sealers, so in the demo one organisation can halt FISCO (known risk; production gives each member its own sealer and adds a fourth member).

## Account architecture

- **Safe7579** through its launchpad (proven), not Kernel. Fallback if a blocker appears with Safe7579: Kernel v3 (MIT), same modules.
- **Safe native owner = `NoOwner`**: our own 15-line contract whose ERC-1271 always fails, threshold 1. Reason: Safe owners can call `execTransaction` and bypass every 7579 hook; with `NoOwner` they can't, and the nonce-key-0 fallback to owner signatures also fails. (We write our own; never copy Rhinestone's GPL `NoSafeOwner.sol`.)
- **Account creation path** (Alex's RISK_SPIKE item 2 is the proven base): launchpad init with `validators = [PasskeyValidator(x, y, credIdHash), AgentKeyValidator(empty)]`, `executors = []`, `hooks = []`, registry attesters `[0x000000333034E9f539ce08819E12c1b8Cb29084d]`, threshold 1 (GS000 fix). The init userOp's `callData` = `execute(batch, [self.setRegistry(0, [], 0), self.installModule(4, MandateHook, abi.encode(uint8 0 /*GLOBAL*/, bytes4(0), "")), self.installModule(2, StandingOrders, "")])`. Passing the hook in launchpad `hooks` fails (`InsufficientAttestations`, tested by Alex). Not yet proven, so V1 tests it first: NoOwner as Safe owner with PasskeyValidator validating the first op (Alex used an ECDSA owner). `packages/userop` gets its own Safe7579 + NoOwner account adapter (address, initHash, nonce key); permissionless' ECDSA-owner path is not used. Fallback 1 if validators are registry-checked at setup: keep the registry **on** and make our own address the trusted attester, attesting our modules in the Rhinestone registry. Fallback 2: Kernel v3.
- **Validators** (ours, ERC-7579 type 1, selected by the nonce key `uint192(uint160(validator)) << 32`, i.e. the top 20 bytes of the nonce):
  - `PasskeyValidator`: up to 4 owner passkeys per account (P-256, keyed by `credIdHash`), verified with Coinbase WebAuthn.sol (MIT) on the RIP-7212 precompile `0x100`. Accepts only `execute`, `installModule`, `uninstallModule` callData.
  - `AgentKeyValidator`: the agent's secp256k1 key from the TEE. Only `execute(...)` callData; expiry; revocable; written only by the hook.
  - **Both return `0xffffffff` for every ERC-1271 request.** Otherwise USDC's `permit` / `transferWithAuthorization` (FiatToken v2.2 accepts ERC-1271) would let anyone pull funds without the hook running.
- **Hook**: `MandateHook`, the single global hook (Safe7579 supports exactly one; no HookMultiPlexer). Every `execute`, `executeFromExecutor`, `installModule`, `uninstallModule` and fallback call passes it. Uninstall and any module change need an owner action (owner + bank).
- **Executor**: `StandingOrders` (ERC-7579 type 2).
- **Paymaster**: `PraetorPaymaster` (our own verifying paymaster). Users never hold ETH. Our bundler is the only bundler; refused userOps are paid by the paymaster and rate-limited.
- Every execution passes the hook **whoever signed it** (agent or owner). The owner's power is expressed as approvals and owner actions that the hook verifies, never as a bypass. Consequence (stated honestly in the self-assessment): a consortium freeze also stops owner-initiated payments; the account is self-custodial but regulated, like a bank account under a freeze order.

## Approvals and tiers (final)

| Tier | What | Who | Verified on Base by |
|---|---|---|---|
| T0 Never | Over bank caps or hard cap, sanctioned, unapproved asset or counterparty, jurisdiction blocked, hidden call (delegatecall, ETH value), stale price, slippage, while FROZEN | Nobody | Hook reverts |
| T1 Autonomous | Inside policy and caps, allowlisted payee, bands respected, status ACTIVE; due standing orders | Agent alone | Hook |
| T2 Human | Unknown payee, over the auto cap, over the user's own budget/count/buffer, over the rebalance limit | Owner via SOTER (WeChat) **or** passkey | `Tier2Approval` + passkey (WebAuthn.sol) or attester-signed `SoterApproval` |
| T3 Owner + bank | Policy changes (caps, payees, bands, merchants), standing orders, WeChat link, agent key rotation, owner passkey change, module changes | Owner (passkey, or SOTER on phones without passkeys) **and** bank | `OwnerAction` + owner auth + bank ECDSA |
| T3− Owner alone | Making things stricter: revoke the agent key, pause the agent, remove a payee, cancel a standing order, unlink WeChat, cancel a recovery | Owner alone | `OwnerAction` + owner auth |
| T4 Consortium | Status (freeze, restrict, loosen), heartbeat, sanctions, jurisdictions, assets and counterparties, caps per risk profile, attester registry, audit anchors | Members: 1 of 3 to tighten, 2 of 3 to loosen; bank alone for caps/assets/attesters/KYA | `ecrecover`, nonce = stored + 1 (allocated by FISCO), submit deadline |

Rule of thumb everywhere: **stricter needs fewer signatures than looser.**

## Assets, prices and the desk

- USDC (Circle, 6 dp). tXAU and tXAG: our ERC-3643 tokens, 18 dp, 1 token = 1 troy ounce.
- `PriceOracle` (ours) on Base, fed by `oracle-feeder` from **Pyth Hermes** (`https://pyth.dourolabs.app/hermes`, needs `PYTH_API_KEY`), feeds XAU/USD `0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2` and XAG/USD `0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e`. Metals don't trade on weekends: `maxPriceAge` default 4 days. A **demo shock** (`scripts/demo/shock.ts --asset XAU --pct 20`) pushes an overridden price through the same feeder, flagged `source = DEMO` in the event and shown as "demo price" in every UI; it sets a **demo hold** (`DEMO_HOLD_S`, default 600) during which the feeder doesn't overwrite it with Pyth, and the scheduler wakes immediately on a `PriceUpdated(source = DEMO)` event.
- `TreasuryDesk` (ours): swaps USDC ↔ tXAU/tXAG at the oracle price ± spread (30 bps), mints/burns the tokens (desk holds the ERC-3643 agent role for minting). Seeded with USDC liquidity.
- Example policy bands (demo, "balanced"): USDC 40–60% (target 55), tXAU 20–35% (target 30), tXAG 0–15% (target 15); max 1 rebalance/day; max 1,000 USD per trade; max slippage 100 bps.

## Identity

- **WeIdentity** on FISCO: bank = Authority Issuer, type `KYC_PROVIDER`. CPTs `PersonKYC` and `AgentMandate` (fields in 05). Version bundle proven by Alex's spike (43 PASS): reuse `infra/weid` configs. DID chain id label 101.
- KYC data stays in the bank service, encrypted (SM4 in Guomi profile, AES-GCM otherwise). **Never** sent to the agent, the LLM, the MCP server or any log.
- The agent's WeID is created from the agent key's public key (inside the TEE flow). WeIdentity doesn't enforce DID recovery, so rotation is our flow F10.

## Agent

- **OpenCode** (`opencode-ai`, pin the exact version found in Phase 0) running `opencode serve` (HTTP API, basic auth) in a container. Model: `opencode/deepseek-v4.1-flash-free` (free for a limited time, zero-retention provider); fallback `opencode/deepseek-v4.1-flash` (paid, needs `OPENCODE_API_KEY`). Model id comes from env.
- The agent acts **only** through our MCP server. "Bring any agent": any MCP client can connect with OAuth (reused from BSA Sentry; claude.ai requires OAuth with DCR + PKCE); its key still lives in our TEE and its actions still pass the hook.
- **The product, the demo, the live suite and the red-team suite use the real model.** A scripted fake LLM exists only in automated tests during the build (an LLM never answers twice the same way, so flow tests would fail at random, and hundreds of night runs would burn the free model's limits).
- **Praetor hosts every user's agent** (one OpenCode instance per user, started when the agent is woken or the user chats, stopped when idle); users install nothing. No capacity limit in the product. In production this is financed by a subscription; bringing your own agent stays an option, never an obligation.

## Recurring payments

- **Fixed amounts** (rent, subscriptions) = **standing orders**, stored on-chain in the `StandingOrders` executor of the wallet: payee, amount, period, next due date, rail, merchant hash. Only owner + bank can create one; fixed amount and payee, one payment per period, anyone can trigger it, the hook still checks freeze, sanctions, jurisdiction and bank caps. On-chain because the wallet itself must enforce the authorisation: kept in our database, a compromised backend could change the amount or the payee.
- **Variable amounts** (electricity, phone) = the agent's normal `pay` tool to an allowlisted payee: alone under the auto cap (T1), Face ID above it (T2).
- **No invoicing.** No invoice objects, no invoice data anywhere on-chain.
- **No personal data on Base (I19).** On the public chain only addresses, amounts and hashes: for Alipay+/WeChat Pay the visible payee is the payout partner's address and the merchant is `merchantRef = keccak256(merchantId)`. Merchant names, labels ("Rent, Kowloon Lettings"), references and invoices live off-chain in the api database (access-controlled) and in the consortium's audit records, linked to the Base transaction by hash. Amounts stay public like any on-chain payment (confidential tokens: roadmap).

## TEEs

- **Phala Cloud dstack (Intel TDX)** in prod; **`phala simulator`** locally (`DSTACK_SIMULATOR_ENDPOINT`). SDK pinned **`@phala/dstack-sdk@0.5.8`** (v0 API: `getKey`, `getQuote`); never 0.6.x (different key derivation).
- What identifies the code: RTMR3 (`compose-hash`, `app-id`). The bank registers both. Prod config refuses simulator quotes.
- Two separate CVMs = two measurements: `agent-signer`, `soter-attester`. Secrets (mini program secret, HMAC keys) as Phala encrypted env vars. Keys derived inside with `getKey`, never exported.

## Bridge

- Security = member signatures verified by the hook. Transport = **WeCross** (`BRIDGE=wecross`) with **relayer fallback** (`BRIDGE=relayer`), same messages. Last resort: a member submits directly.
- WeCross v1.4.0 is dormant (last commit March 2024), JDK 8, BCOS3 stub built against java-sdk 3.6.0, **no EVM stub exists**: we write it (Java 8, web3j 4.9.x). Phase 0 checks the BCOS3 stub against FISCO 3.17.1; if it fails, fix in a fork of the stub (Apache-2.0) and log it.

## Hosting

- Build and test **everything locally first**, deploy after. Local is a small prod: one `docker compose` for all services, same images in prod. See [11-environments.md](11-environments.md).
- Prod: one Tencent Cloud Lighthouse **Hong Kong** server (4 vCPU / 16 GB, ~54 USD/month) + two Phala `tdx.small` CVMs + own `.com` (DNS only, no CDN proxy) + Caddy with Let's Encrypt. GitHub only. No Vercel, Railway, CloudBase, Google services.
- The mini program runs on team phones only (test account, debug mode). Judges use the web app.

## Repo and licence

- New private GitHub repo. **No open-source licence** ("All rights reserved"); `THIRD_PARTY_LICENSES.md`, `NOTICE`, `docs/PREEXISTING.md` (BSA Sentry reuse, with the authors' agreement; Alex's skeleton).
- Never copy GPL code into our contracts: T-REX (GPL-3.0) → own ERC-3643; Safe7579, Rhinestone registry and core-modules (GPL-3.0) → use deployed contracts, own interfaces. Safe (LGPL-3.0) deployed, unmodified.
- Languages: Solidity 0.8.28 (Base: cancun; FISCO: paris), TypeScript on Node 22 (pnpm workspaces, strict, ESM), Java 8 (WeCross EVM stub, WeIdentity helper), WXML/JS (mini program).
- Datastore: one MySQL 8 container (WeIdentity, WeBASE and WeCross need MySQL anyway), one database and one user per service. Node services use `mysql2` + `drizzle-orm`.

## Demo numbers

Persona **Lin**, Hong Kong resident, risk profile `balanced`, KYC level 2. Starts with 10,000 USD: 5,300 USDC, 3,200 USD of tXAU, 1,500 USD of tXAG. Policy: auto cap 200 USDC, hard cap 2,000 USDC, daily budget 500, monthly 3,000, 10 payments/day, buffer 1,000 USDC, payees: Landlord, Utilities, Café. Bank caps for `balanced`: per tx 5,000, daily 10,000, monthly 50,000. Standing order: rent 1,200 USDC monthly to "Kowloon Lettings" via Alipay+ (mock). Gold shock +20% → USDC 49.8% / tXAU 36.1% / tXAG 14.1% → tXAU > 35% → agent sells ≈ 650 USD of tXAU back toward 30%.

## Signature separation between environments

The EIP-712 domain name carries the environment: `"Praetor"` on live Base Sepolia (prod and live suites), `"Praetor-local"` on the anvil fork, `"Praetor-sandbox"` for the judges' sandbox. Local, live and sandbox use **different member keys**. A signature made in one environment can never be replayed in another, even though fork and live share chainId 84532.

## Judges' sandbox isolation

The sandbox runs on its **own deployment** (its own MandateHook, validators, oracle, desk; same code) with its own sandbox member keys held by the server, domain name `"Praetor-sandbox"`. Server-signed "regulator freeze" buttons can only ever touch sandbox accounts; the real consortium keys never sign anything for a web button.
