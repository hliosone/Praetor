# Phase 0: environment check and verification spikes

Started 2026-10-17 03:30 UTC. Each spike: what was run, what was seen, verdict, fallback. Spike code lives under `spikes/V<n>-*/` (small, documented, kept in the repo).

## 1. Environment (spec 10, Phase A list)

Machine: Linux 7.0.0-38 (Ubuntu 24.04), 16 CPUs, 30 GiB RAM (19 GiB available at check), 33 GiB swap, 241 GB free disk on `/` (Docker root `/var/lib/docker` on the same disk). User in the `docker` group.

| Item | Required | Found | Verdict |
|---|---|---|---|
| Docker + compose v2 | yes | Docker 29.9.0, Compose v5.6.0 | OK |
| Node 22 + pnpm | yes | Node 22.22.0, pnpm 10.29.1 | OK |
| Foundry | yes | forge/anvil/cast 1.7.1 | OK |
| Slither | yes | 0.11.6 | OK |
| Python 3 + uv/uvx | yes | Python 3.12.3, uv/uvx 0.10.3, pipx 1.4.3 | OK |
| JDK 8 (WeCross) | yes | missing (host has OpenJDK 21 JRE only, no `javac`; a JDK 25 under `~/.jdks`) | use pinned `eclipse-temurin:8-jdk` image (see V4) |
| JDK 11 (WeIdentity tools) | yes | missing | use pinned `eclipse-temurin:11-jdk` image (see V3) |
| Gradle | per project wrapper | no global gradle (fine: wrappers) | OK |
| cloudflared | yes | 2026.10.0 | OK |
| gh (logged in) | yes | 2.45.0, logged in as `hliosone`, repo `hliosone/Praetor` private | OK |
| Playwright Chromium | yes | `~/.cache/ms-playwright/chromium-1217`, `-1223` + Google Chrome | OK |
| WeChat DevTools Linux port | yes | not found on this machine (`~/wechat-devtools` absent) | MANUAL step (see V11) |
| `phala` CLI | yes | missing | installed by V5: `phala@1.1.22` in the user's nvm prefix |
| gitleaks | yes (make test) | missing | pinned image in M0 (Q5) |
| opencode | (V6) | missing | installed by V6: `opencode-ai@1.19.3` in the user's nvm prefix |
| openssl | (keys) | 3.0.13 | OK |

Ports: none of 80, 443, 3306, 6001, 8545-8548, 18545, 20200-20203, 30300-30303, 8250, 5002, 4096 were listening at check time. No container was running.

`.env` (mode 600) before Phase 0: 8 human entries, **all empty**: `MP_APPID`, `MP_SECRET`, `OA_APPID`, `OA_SECRET`, `OA_TOKEN`, `OA_TEMPLATE_ID`, `PYTH_API_KEY`, `OPENCODE_API_KEY`. Impact: V8 (Pyth) and V11 (WeChat) cannot be confirmed with our own credentials; V6 tries the free model without a key. See QUESTIONS.md.

Keys: `scripts/keys/generate.ts` filled 72 values into `.env` (15 secp256k1 roles x 3 sets `LOCAL_`/`LIVE_`/`SANDBOX_`, plus shared secrets). Re-running it adds nothing (tested). Public addresses: `docs/QUESTIONS.md`, section "Funding".

Assistant attribution: the current Claude Code setting is `attribution: {commit: "", pr: ""}` (`includeCoAuthoredBy` deprecated since v2.0.62 but still read), source https://code.claude.com/docs/en/settings-reference.md, section "Git and attribution". Both are set in `.claude/settings.json`; `scripts/git-hooks/commit-msg` rejects `Co-Authored-By` (any case) and `Claude` (case-sensitive), tested by `scripts/git-hooks/test-commit-msg.sh` (message files + a real commit in a throwaway repo).

## 2. Spikes

Each row links to the spike's `RESULT.md` (commands, raw observations, traps with defaults). V1, V4 and V5 to V8, V10 were run by background workers forked from this session, under the rule that only the main session commits; everything else was run directly.

| # | Verify | Verdict | Fallback applied / what changes |
|---|---|---|---|
| V1 | Safe7579 creation path on the fork, hook coverage, I1, I16, I17 ([result](../spikes/V1-safe7579/RESULT.md)) | **PASS** (17 fork tests) | No registry fallback: validators passed at setup skip the registry. **Gap found (I1)**: a passkey-validated direct `uninstallModule(hook)` removes the hook without preCheck. Default fix in QUESTIONS Q14; init batch order must install the executor before the hook (Q15); `setupSafe` selector (Q16) |
| V2 | FISCO 3.17.1 in Docker, auth mode, governors, deploy ACL, SM profile ([result](../spikes/V2-fisco/RESULT.md)) | **FALLBACK (own image)** | No `fiscoorg/fiscobcos:v3.17.1` image: own image from the sha256-pinned release binary. Everything else works. `eth_getLogs` scans only the first 10 blocks of a range. SM mode: SHA3 and selectors are SM3, web3 RPC cannot sign, Java SDK 3.8.0 can |
| V3 | WeIdentity bundle on that chain, both profiles ([result](../spikes/V3-weid/RESULT.md)) | **PASS** non-SM (43 PASS + 1 INFO); **PASS deploy-only** on SM | Admin key must be fixed and opened in the deploy whitelist (Q32); SM scenario left to M15 |
| V4 | WeCross v1.4.0 router + BCOS3 stub vs 3.17.1, hub, EVM proxy ([result](../spikes/V4-wecross/RESULT.md)) | **PARTIAL** | Router + stock stub (java-sdk 3.6.0) work on 3.17.1 without a stub patch; EVM side (our stub + patched proxy, which compiles) is M12 work; relayer stays primary until then. Hub queue blocks on an undeliverable request; two unguarded hub setters (Q38 to Q40) |
| V5 | `phala` simulator + `@phala/dstack-sdk@0.5.8` from a container ([result](../spikes/V5-dstack/RESULT.md)) | **PASS** | `DstackClient.getKey` stable across calls and restarts; simulator mode must come from config (Q33) |
| V6 | OpenCode serve API, per-account instance, free model, tool lockdown ([result](../spikes/V6-opencode/RESULT.md)) | **PASS with a config change** | Free model works without a key; `tools: {"*": false}` makes it refuse (403), so lockdown is `permission: ask` + auto-reject (Q34) |
| V7 | `ant-intl-alipayplus-mcp` paths and signing ([result](../spikes/V7-alipayplus/RESULT.md)) | **PASS** | Real client round trip against a fake gateway; quirks in Q37 |
| V8 | Pyth Hermes, both feeds ([result](../spikes/V8-pyth/RESULT.md)) | **PENDING `PYTH_API_KEY`** | Every Hermes host answers 401 without a key. Until the key: seeded prices with `source = DEMO` (Q27) |
| V9 | WeBASE-Front for 3.17.1 ([result](../spikes/V9-webase/RESULT.md)) | **PASS (patched build)** | No downloadable 3.x artifact or image; source build needs the scaffold feature removed (Q41) |
| V10 | Circle USDC, Base Sepolia infrastructure, faucet ([result](../spikes/V10-usdc/RESULT.md)) | **PASS** | FiatToken v2.2 with ERC-1271 overloads; `DEMO_SCALE=100`; sandbox on "pUSD" (Q30, Q31) |
| V11 | Mini program SOTER, `wx.login`, debug mode; OA templates ([result](../spikes/V11-wechat/RESULT.md)) | **PENDING `MP_*`, `OA_*`** | Alex's iPhone results stand; API reachable; fallback for notifications: customer-service text |

## 3. Measurements

| What | Value | Source |
|---|---|---|
| One idle `opencode serve` (1.19.3) | **342 MB RSS** after boot | V6 |
| Same, while answering | **834 to 853 MB** peak, 593 to 655 MB afterwards | V6 |
| Implied capacity on the 16 GB prod server | about 8 to 12 awake agents at once (Q35) | V6 |
| FISCO node (Docker) | about 20 MiB RSS, about 25% of one core idle, each | V2 |
| WeCross router / account manager (JVM defaults) | about 1.15 to 1.35 GiB / 0.6 GiB | V4 |
| WeBASE-Front (JDK 11 defaults) | about 714 MiB | V9 |
| Base Sepolia gas price | about 0.006 gwei | V10 |
| First userOp (deploy + setup + init batch), fork | 1,350,131 gas (inflated: no P-256 precompile in forge, FCL verify about 353k) | V1 |
| Agent userOp, fork | 373,261 gas (same caveat) | V1 |

## 4. Phase 0 state left running

Stopped at the end of Phase 0 (see PROGRESS.md): FISCO chains `p0v2` and `p0v2sm`, `p0v3-mysql`, `p0v3-rest`. The spike chains are disposable: M4 builds the real chain under `infra/fisco` from scratch. Docker volumes `p0v3-gradle` and `p0v9-gradle` (Gradle caches) are kept to speed up M4 to M12 builds.
