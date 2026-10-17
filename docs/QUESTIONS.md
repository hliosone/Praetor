# Questions (Phase 0)

How to answer: write your answer under a question (or "OK" to accept the default), or answer in chat. **Anything left unanswered gets the default shown.** Questions the spec already answers are not asked. Numbering is stable; groups follow the milestones of `spec/10-build-plan.md`. Spike evidence is in `docs/PHASE0.md` and `spikes/V*/RESULT.md`.

## Funding (before "go")

Base Sepolia (chain 84532). Gas measured at about 0.006 gwei (V10); amounts below assume 8x that, so they are generous. Our own bundler means the paymaster needs a deposit but **no EntryPoint stake**. The deposit is paid from the deployer at deploy time. Consortium Base-signer keys, the recovery guardian and every FISCO key need **no ETH** (they only sign; the bundler submits).

**Priority 1: LIVE set** (needed for M16, the live run and the evidence):

| Role | Address | Fund with | Why |
|---|---|---|---|
| LIVE_DEPLOYER | `0x7b5bB06482513F6032baD053018ee387A7dac771` | 0.04 ETH | about 30M gas of contracts (redeploys included) + 0.02 ETH paymaster deposit |
| LIVE_BUNDLER | `0xD76eEF0179d98f9aEAAAd1F26d05d2425E2C9915` | 0.03 ETH | `handleOps`, refused ops (about 150k gas each), `registerApproval`, `apply*`, RefusalLog |
| LIVE_WECROSS_BASE | `0xbD644c848D5eCD335725F0cBC51F1E04dC153C66` | 0.005 ETH | WeCross deliveries to `WeCrossInbox` |
| LIVE_ORACLE_FEEDER | `0x79B8B5b9923B04e06f5A4AA652D3C0443c5B995E` | 0.005 ETH | `PriceOracle.setPrice` |
| LIVE_DESK_OPERATOR | `0x010a86704C2a8dcEDF76e375fcEdc9c3CB60033f` | 0.005 ETH | identity registry, desk settings, token agent actions |
| LIVE_PAYOUT_PARTNER | `0xB5140A52cF031730Cde446b6C0ee2f2238dba5a5` | 0.003 ETH | `PayoutRail.withdraw` / `settle` / `fail` |
| LIVE_TREASURY | `0x5BB2f2E1753C972cB60762E6a555Bd3B3953cd12` | 0.003 ETH **+ about 100 USDC** (Circle faucet: 20 USDC per 2 h per address, so 5 requests) | desk USDC liquidity and Lin's account at `DEMO_SCALE=100` (Q30) |

Total LIVE: about **0.091 ETH + 100 USDC**.

**Priority 2: SANDBOX set** (judges' sandbox on live Base Sepolia; only needed for the deployment rehearsal and Phase C, so it can wait):

| Role | Address | Fund with |
|---|---|---|
| SANDBOX_DEPLOYER | `0x3AC957e02D46CEEA6377E05F22E6c5aFfDd6f330` | 0.04 ETH (includes paymaster deposit) |
| SANDBOX_BUNDLER | `0xB4f4B8f7FB34e58F2ecb1F7fD353163C13278Ce4` | 0.03 ETH |
| SANDBOX_ORACLE_FEEDER | `0x2912e068D8d6D5C98ccc18384c486CD025b89478` | 0.005 ETH |
| SANDBOX_DESK_OPERATOR | `0xA24A435f43C985b3B4E309D4303B1ab6f8fE88EE` | 0.005 ETH |
| SANDBOX_PAYOUT_PARTNER | `0xb87431Dc2206EEb0DD326Baed49f93F666a0CDE4` | 0.003 ETH |
| SANDBOX_TREASURY | `0xF5428848Ee8CDC6ae0360A984FBF2767bB473164` | 0.003 ETH (no USDC: the sandbox uses our own "pUSD", Q31) |

Total SANDBOX: about **0.086 ETH**. LOCAL keys need nothing (the fork funds them with `anvil_setBalance` / `deal`).

**Before saying "go": keep the machine awake.** Phase 0 found no sleep inhibitor (only delay locks; KDE PowerDevil handles the lid switch), so a suspend would silently kill Phase B overnight. Run, in a terminal you leave open: `systemd-inhibit --what=sleep:idle:handle-lid-switch --who=praetor --why="Phase B build" --mode=block sleep infinity` (or set KDE power management to never suspend on AC). Keep the laptop on AC power.

**Human values to put in `.env`** (all 8 are empty today; never paste them in chat):
- `PYTH_API_KEY` (V8: every Hermes host now answers 401 without it). Without it, the feeder runs in "seeded" mode (Q27).
- `MP_APPID`, `MP_SECRET`: the mini program test account of the person whose phone does Phase C (Q36).
- `OA_APPID`, `OA_SECRET`, `OA_TOKEN`, `OA_TEMPLATE_ID`: Official Account test account (+ one test template).
- `OPENCODE_API_KEY`: optional. The free model works without it (V6). Needed only if the free tier stops answering.

## General

**Q1. Deadline and cut order.** Alex's reports give the submission deadline as **Tue 20 Oct 2026, 23:59 Beijing (17:59 CEST)**. The spec has no cut order, and M0 to M18 is a very large build for the time left. Default: build in milestone order. If Phase B is not done by **Tue 20 Oct 08:00 Beijing (02:00 CEST)**, finish the milestone in progress, then go straight to M16 (live evidence) and M17 (docs). Cut from the end of this list first: (1) Guomi smoke, (2) WeCross transport (relayer stays the bridge), (3) WeBASE explorer, (4) mini program pages other than home/approve/link, (5) sandbox on its own deployment (falls back to a UI over the main fork deployment), (6) EUDI wallet path (mock KYC stays). Never cut: the hook and its tiers on-chain, freeze FISCO to Base, SOTER and passkey approvals, the real model through MCP, evidence. Please confirm the deadline and the order.

**Q2. Three key sets in one `.env`.** Spec 11 lists unprefixed names (`BUNDLER_KEY`...), and spec 00 requires different member keys for local, live and sandbox. Default (already generated, D1): every wallet key exists three times, as `LOCAL_*`, `LIVE_*` and `SANDBOX_*`. Services read the unprefixed name first (prod's server `.env`), then the prefix of the active set (`CHAIN_MODE=fork` gives LOCAL, `live` gives LIVE, the sandbox deployment gives SANDBOX).

**Q3. One deployer for both chains; bank FISCO account as FISCO governance admin.** Default (D2): `DEPLOYER_KEY` deploys on Base and FISCO and is the only deployer opened in the FISCO deploy whitelist, besides WeIdentity's and WeCross's own deployers (Q32, Q40), opened through the committee (Q22). `build_chain.sh -a` gets the bank's FISCO address (spec 04).

**Q4. Versions.** Default: exact pins everywhere. Node tooling pinned to TypeScript 5.9.3 (not the new TypeScript 7 native compiler), vitest 3.2.7, viem 2.57.5, tsx 4.23.15. Pinned images by digest. OpenCode 1.19.3, phala CLI 1.1.22, dstack-sdk 0.5.8, FISCO 3.17.1, WeIdentity 3.1.1-rc.2, WeCross 1.4.0, WeBASE-Front 3.1.1.

**Q5. Host toolchains.** JDK 8 and 11, gitleaks and WeChat DevTools are missing on this machine. Default: Java builds and runs only in pinned `eclipse-temurin` images (no host JDK), gitleaks from a pinned image, DevTools left to Phase C (MANUAL). The `phala` CLI (1.1.22) and `opencode-ai` (1.19.3) are installed in the user's npm prefix.

## M0: scaffold and compose

**Q6. Anvil and the P-256 precompile.** Plain `anvil --fork-url` has no RIP-7212 precompile at `0x100`; `anvil --network optimism` has it (V1). `forge test --network optimism` panics on Base Sepolia forks (forge 1.7.1). Default: compose runs `anvil --fork-url ... --chain-id 84532 --network optimism`. Foundry fork tests accept FreshCryptoLib's slower WebAuthn path (about 353k gas). Gas figures for the report come from anvil with `--network optimism`, or from live.

**Q7. Fork pinning.** Default: M0 pins `FORK_BLOCK` (recorded in `infra/deployments/fork.json`) so fork tests are reproducible; refreshed only on purpose.

**Q8. Base Sepolia RPC.** The public `sepolia.base.org` lags and rate-limits (Alex). Default: public RPC with receipt-block reads and retries. If you have an Alchemy/QuickNode/Coinbase CDP key, put it in `BASE_LIVE_RPC_URL` (optional).

**Q9. Compose network.** Many 172.x and 192.168.x subnets are in use on this machine. Default: Praetor's compose network is `10.88.0.0/16`, FISCO nodes on fixed IPs (their `nodes.json` holds IP:port).

**Q10. FISCO image.** `fiscoorg/fiscobcos:v3.17.1` does not exist (newest is v3.12.1). Default (V2 fallback): `infra/fisco/Dockerfile` builds from the official release binary, pinned by sha256. `build_chain.sh` docker mode is `-D` now (the spec says `-d`, which is now the CA path); we do not use it (it runs `--network=host`).

## M1: protocol

**Q11. REMOVE_PAYEE payload.** Spec 02 says "`abi.encode(address payee)` or `abi.encode(bytes32 merchantKey)` with a leading `uint8` tag", which can be read two ways. Default: `abi.encode(uint8(0), address payee)` or `abi.encode(uint8(1), bytes32 merchantKey)` (two words, tag first).

**Q12. Canonical audit JSON.** RFC 8785 has no integers above 2^53. Default: every uint256 field (amounts) is a decimal string, hashes and addresses are lowercase `0x` hex, `atMs` is a JSON number (ms fits in 2^53).

**Q13. Test keys on a fork.** Low-entropy keys (and probably anvil's well-known keys) carry EIP-7702 delegation code on Base Sepolia, which changes signature paths on a fork (V1 T8). Default: golden vectors keep anvil keys 1 to 4 (pure computation, no chain), and every fork test key is `keccak256(label)`.

## M2: Base contracts

**Q14. (Critical, I1) The hook cannot block its own removal.** On the deployed Safe7579, `uninstallModule` skips the hooks when the module is the hook itself and swallows a reverting `onUninstall` (V1 T1). Spec 03 lets PasskeyValidator accept raw `uninstallModule` callData, so **the owner's passkey alone could remove MandateHook without the bank**. Default: PasskeyValidator accepts only `execute` (plus the launchpad's `setupSafe` for the first op, Q16). Module changes become `execute(single, account, installModule|uninstallModule(...))`. MandateHook allows that one self-call shape (an exception to rule 5 "target == account → HIDDEN_CALL") only with a live `moduleApprovals[account][callHash(account, 84532, account, 0, innerData)]`. It consumes the approval in the outer preCheck, passes it to the inner `installModule` preCheck through transient storage, and sets `uninstalling` for a hook removal. The module-change shape is accepted only as a **single** call (never inside a batch). Because the hook cannot tell which validator signed an op, **AgentKeyValidator rejects any `execute` whose call targets the account itself** (single or any batch entry), so the agent key can never carry out a module change even while a MODULE_CHANGE approval is live (I7). I will update spec 03 with a note at the top.

**Q15. Init batch order.** Spec 00/06 order `[setRegistry(0), installModule(4, hook), installModule(2, executor)]` sends the executor install through the hook just installed, which refuses it, so the first op fails (V1 T2). Default: `[setRegistry(0), installModule(2, StandingOrders), installModule(4, MandateHook)]` (proved on the fork). Spec 00 and 06 get a note.

**Q16. PasskeyValidator and `setupSafe`.** It must accept the launchpad's `setupSafe(InitData)` selector (`0xd9ed0e8f`) or no account can be created (V1 T4). After setup that selector reaches the hooked fallback, which has no handler and reverts. Default: accept it.

**Q17. USDC's ERC-1271 overloads.** USDC here is FiatToken v2.2 with bytes-signature overloads of `permit`, `transferWithAuthorization` and `receiveWithAuthorization` (V10). Default: the hook classifies all of them (and `transferFrom`, `approve` outside the pattern) as SELECTOR_NOT_ALLOWED. The I16 tests call all three overloads with agent-key, passkey and empty signatures. A red-team case covers "delegatecall to SignMessageLib then permit with an empty signature" (closed only by the hook refusing delegatecall, V1 T9).

**Q18. LINK_WECHAT before any policy.** F2 can run before F3, while `registerApproval` with SOTER requires `policy.soterEnabled`. Default: LINK_WECHAT does not require a policy or `soterEnabled` (it only sets the binding). SOTER as approval or owner auth still requires `soterEnabled` and a binding.

**Q19. Patched WeCrossProxy needs `via_ir`.** Default: `via_ir` only in that contract's Foundry profile (V4 T10).

## M3: userop, chain, bundler

**Q20. A failed first op bricks the address.** Its validation side effects persist and every retry fails with `AA23` (V1 T3). Default: the bundler simulates the first op and never submits it unless the simulation succeeds. If an address is ever bricked, the api picks a new salt.

**Q21. ETH prefund outside the hook.** `validateUserOp` pays missing prefund to the EntryPoint outside the hook (V1 T10). Default: the bundler always sponsors through PraetorPaymaster, accounts hold no ETH, and the self-assessment mentions it.

## M4: FISCO

**Q22. Deploy whitelist and the bootstrap order.** Genesis committee rates are 0 (every proposal passes on creation). Default bootstrap (V2): add regulator, add operator, set rates 51/51, then whitelist deployers. Each later proposal needs a second governor vote. Every tool that brings its own deployer (WeIdentity Build-Tools, the WeCross stub) is opened through the committee, and its key comes from `.env` (Q40).

**Q23. `eth_getLogs`.** On 3.17.1 the node scans only the first 10 blocks of the requested range and silently drops the rest (V2: [0,23] returns nothing, [12,23] returns blocks 12 to 21). It also needs `address` + `topics`. Default: `packages/fisco-client` always queries 10-block windows from `fromBlock`.

**Q24. Naming mismatch.** Spec 05 calls `AgentStatus.proposeStatus`; spec 04 names it `openStatus`. Default: `openStatus` (04).

**Q25. Guomi profile limits.** In SM mode the web3 RPC reads but rejects Ethereum-signed transactions, SHA3 and selectors are SM3, and only SM2-signed transactions are accepted (Java SDK 3.8.0 / console worked, V2). The governance admin must be the bank's SM2 address. Default: the SM smoke (M15) uses the Java SDK in a container and stores attestations as opaque bytes, as spec 04 says.

**Q26. FISCO idle CPU.** Each PBFT node uses about 25% of a core while idle (about one core for 4 nodes). Default: accepted; the prod server has 4 vCPU.

## M5 to M8: member services, identity, TEEs, agent

**Q27. Prices without a Pyth key.** Default: until `PYTH_API_KEY` is set, oracle-feeder runs in "seeded" mode. It pushes fixed XAU/XAG prices from a config file with `source = DEMO`, and every UI shows "demo price". Real Pyth starts automatically once the key is present.

**Q28. First staff passkeys of the member services.** The spec says each member service verifies its own staff passkeys, but not how the first one is enrolled. Default: each member service prints a one-time enrolment token at first boot (overridable by env); tests use Playwright's virtual authenticator, and the human enrols real passkeys in Phase C.

**Q29. Bank's "own channel" for recovery notices.** Default: in the demo the bank reuses the OA test account, and email goes to a local log sink (no real email), documented as a demo simplification.

**Q30. Live scale.** Faucet: 20 USDC per 2 h per address (V10). Default: `DEMO_SCALE=100` for live runs (Lin starts with 100 USDC instead of 10,000; all amounts divided by 100), funded from LIVE_TREASURY.

**Q31. Sandbox money.** Judges cannot each get faucet USDC. Default: the sandbox deployment uses our own test stablecoin "pUSD" (labelled "test dollar" in the UI); the main live deployment uses Circle USDC.

**Q32. WeIdentity admin key.** Build-Tools generates a new admin key on every run unless given `--private-key`; its failed JVM also never exits (V3). Default: add `LOCAL_/LIVE_/SANDBOX_WEID_ADMIN_KEY` to the key generator, write it (decimal) into the build-tools volume at deploy time, open its deploy right through the committee, and run Build-Tools with a timeout.

**Q33. TEE simulator facts (V5).** Simulator keys are publicly derivable (fixed key material), its compose hash is a constant and nothing in a quote says "simulator". Default: simulator mode comes only from our `ATTESTATION_MODE` config; bank-service accepts simulator quotes only when `ATTESTATION_MODE=simulator` (never in prod, I13); `getQuote` receives raw bytes; the simulator socket is mounted at `/var/run/dstack.sock`.

**Q34. (Contradiction) Disabling OpenCode's built-in tools.** Spec 05 says `"tools": {"*": false}`. With the free model, that (or `permission: deny`) makes the provider answer `403 FreeTierError` (V6). Default: `"permission": {"*": "ask", "praetor_*": "allow"}`, and the agent-runner rejects every permission request at once through the event stream. The per-account directory holds nothing but that account's `opencode.json`, and mcp accepts the static per-account bearer only from the agent container's internal network. If the paid model is used later, switch to `tools: false`. I will note it at the top of spec 05.

**Q35. Agent capacity.** Spec 00/11 say "no capacity limit". One awake OpenCode instance takes 0.6 to 0.9 GB (V6), so a 16 GB server holds about 8 to 12 at once. Default: no limit on users, but at most `AGENT_MAX_ACTIVE` (default 8) awake instances. Further wakes and chats queue (a user waits seconds, never gets refused), plus the 30-minute idle stop.

**Q36. Mini program test account owner.** Test accounts are tied to the WeChat account that created them, and one WeChat account works on one phone (Alex). Default: `MP_*` belong to the person whose iPhone runs Phase C; teammates are added as testers.

**Q44. Reused OAuth/MCP storage.** BSA Sentry's `oauth.ts`/`mcp.ts` store clients, codes and tokens in `node:sqlite` (synchronous), while spec 00 puts every service on MySQL with `mysql2` + `drizzle-orm`. Default: port the reused code to drizzle on the `mcp` database (async), keeping Sentry's tests as the spec of behaviour (hashed secrets and codes, PKCE S256, one account per token).

**Q45. EUDI wallet verifier.** Sentry's EUDI path (reused for bank-service KYC) talks to the EU reference verifier backend (`VERIFIER_BACKEND=https://verifier-backend.eudiw.dev`, `INTENDED_USE_ID`), which issues the `client_id` and `request_uri`, so no verifier certificate of our own is needed. That backend sees the presentation (age_over_18 and issuing country, test PID data). Default: reuse that path as is; the generated `EUDI_VERIFIER_KEY`/`EUDI_VERIFIER_CERT` stay unused, kept for a self-hosted verifier (roadmap).

## M10 to M12: payouts, audit, WeCross

**Q37. Alipay+ MCP client quirks (V7).** It always dials HTTPS port 443 (with certificate checks off), crashes with an unpinned `mcp`, prints warnings to stdout (which breaks stdio MCP) if any of its 11 env vars is unset, and reports failures as plain text. Default: the mock listens on 443 inside the Docker network, the client runs as `uvx --from ant-intl-alipayplus-mcp==1.0.1 --with 'mcp[cli]==1.29.1'` baked into the image, all 11 variables are set, and an unclear outcome is resolved with `query_payment` before any refund.

**Q38. A stuck WeCross request blocks the hub (V4).** One undeliverable interchain request makes the router retry forever and never advance the hub index. Default: the relayer watchdog never depends on hub progress, and BaseOutbox targets only `payment.base.inbox`.

**Q39. WeCrossHub has two unguarded setters (V4).** `updateCurrentRequestIndex` and `registerCallbackResult` are callable by anyone on FISCO. Default: hub callbacks are hints only (`BaseOutbox.markDelivered` stays restricted to the router and relayer accounts, first write wins). M12 tries FISCO method ACLs on the hub, and the self-assessment lists the gap.

**Q40. WeCross keys and resources.** The stub generates its own FISCO admin key and the account manager needs a PKCS#1 RSA key (V4). Default: add `*_WECROSS_FISCO_KEY` to the generator, open it through the committee, generate PKCS#1 at image build, and cap the JVMs (`-Xmx512m` router, `-Xmx256m` account manager).

**Q41. WeBASE-Front build.** No v3.1.1 artifact is downloadable from here (CDN 403, the Docker image is the FISCO 2.x line), and the source build depends on dead SNAPSHOT repositories (V9). Default: build from tag v3.1.1 with the scaffold feature removed (`spikes/V9-webase/webase-front-v3.1.1-no-scaffold.patch`), `-Xmx384m`.

## M13 to M18: apps, live, docs

**Q42. Held-out red-team cases.** 20% of the red-team cases must be written by a teammate and kept outside the repo. Default: a MANUAL step for Phase C (who writes them?).

**Q43. Real model in the live and red-team suites.** The free model is "free for a limited time" and rate-limited. Default: the live suites throttle to one request at a time with retries, and switch to the paid model if `OPENCODE_API_KEY` is set and the free tier refuses.
