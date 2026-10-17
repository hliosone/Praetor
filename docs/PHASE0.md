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
| `phala` CLI | yes | missing | installed in V5 (npm, user toolchain) |
| gitleaks | yes (make test) | missing | pinned binary or image in M0 |
| opencode | (V6) | missing | installed in V6 (npm, user toolchain, exact version pinned) |
| openssl | (keys) | 3.0.13 | OK |

Ports: none of 80, 443, 3306, 6001, 8545-8548, 18545, 20200-20203, 30300-30303, 8250, 5002, 4096 were listening at check time. No container was running.

`.env` (mode 600) before Phase 0: 8 human entries, **all empty**: `MP_APPID`, `MP_SECRET`, `OA_APPID`, `OA_SECRET`, `OA_TOKEN`, `OA_TEMPLATE_ID`, `PYTH_API_KEY`, `OPENCODE_API_KEY`. Impact: V8 (Pyth) and V11 (WeChat) cannot be confirmed with our own credentials; V6 tries the free model without a key. See QUESTIONS.md.

Keys: `scripts/keys/generate.ts` filled 72 values into `.env` (15 secp256k1 roles x 3 sets `LOCAL_`/`LIVE_`/`SANDBOX_`, plus shared secrets). Re-running it adds nothing (tested). Public addresses: `docs/QUESTIONS.md`, section "Funding".

Assistant attribution: the current Claude Code setting is `attribution: {commit: "", pr: ""}` (`includeCoAuthoredBy` deprecated since v2.0.62 but still read), source https://code.claude.com/docs/en/settings-reference.md, section "Git and attribution". Both are set in `.claude/settings.json`; `scripts/git-hooks/commit-msg` rejects `Co-Authored-By` (any case) and `Claude` (case-sensitive), tested by `scripts/git-hooks/test-commit-msg.sh` (message files + a real commit in a throwaway repo).

## 2. Spikes

| # | Verify | Verdict | Fallback applied |
|---|---|---|---|
| V1 | Safe7579 creation path on the fork | pending | |
| V2 | FISCO 3.17.1 in Docker | pending | |
| V3 | WeIdentity bundle | pending | |
| V4 | WeCross v1.4.0 + BCOS3 stub | pending | |
| V5 | Phala simulator + dstack-sdk 0.5.8 | pending | |
| V6 | OpenCode serve + free DeepSeek | pending | |
| V7 | ant-intl-alipayplus-mcp HTTP + signing | pending | |
| V8 | Pyth Hermes | pending | |
| V9 | WeBASE-Front for 3.17.1 | pending | |
| V10 | Circle USDC on Base Sepolia, faucet | pending | |
| V11 | Mini program SOTER, OA templates | pending | |
