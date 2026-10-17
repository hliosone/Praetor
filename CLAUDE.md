# CLAUDE.md: Praetor

**Starting a new session or lost context? Read this file, then `docs/PROGRESS.md`. Run `make setup && make test` (and, once they exist, `make test-int` and `make e2e`). Resume at the first unchecked item of PROGRESS.md, autonomously. The spec is `spec/` (start with `spec/README.md` and `spec/00-decisions.md`); Phase 0 findings are in `docs/PHASE0.md`, open choices and their defaults in `docs/QUESTIONS.md`, decisions taken since in `docs/DECISIONS.md`.**

Praetor is our FinTechathon 2026 entry (International Track, Topic F "Agent Wallet"): an AI agent manages a portfolio and pays bills from an ERC-4337 Safe7579 account on Base Sepolia, bounded by an on-chain Mandate hook, with a FISCO BCOS consortium (bank, regulator, operator) holding the authority. One Claude Code session builds it, test first, component by component, from `spec/`.

---

## 0. Run mode (overrides everything else)

Phases (spec 10): A = human preflight (done), **0 = checks + questions (done; one planned stop)**, **B = autonomous build M0 to M18**, C = guided acceptance with the human (`docs/MANUAL.md`).

- **Where we are is written in `docs/PROGRESS.md`.** If Phase 0 is done and the human has not said "go", wait for "go". After "go": (1) read the answers in `docs/QUESTIONS.md` (or in chat), check them against the spec, record them in `docs/DECISIONS.md`, change `spec/` only where an answer changes a decision (with a note at the top of the changed file), update this file if needed, commit; (2) build M0 to M18 in order with their gates; (3) at the end print **READY FOR PHASE C** with what works, what used a fallback, what is blocked, and step 1 of `docs/MANUAL.md`.
- **Phase B: never stop, never ask, never wait.** Do not end the turn until M18 is done or every remaining item is truly blocked. This **overrides the global `~/.claude/CLAUDE.md` "if unclear, stop and ask" rule and the antigravity skill's "halt for approval" / `implementation_plan.md` / `task.md` steps**. Their TDD, simplicity and surgical-changes guidance still applies; `docs/PROGRESS.md` is the checklist.
- **Ambiguity**: take the safest option that keeps invariants I1 to I19 (`spec/01-system.md`), record it in `docs/DECISIONS.md`, continue. Unanswered questions in QUESTIONS.md get the default written there.
- **Blocked**: write it in `docs/BLOCKERS.md` (what, why, what you tried, fallback taken), apply the fallback from `docs/PHASE0.md` or the spec, move to the next milestone that does not depend on it, come back later.
- **Anything that needs a human** (Face ID on a phone, WeChat DevTools QR login, EUDI wallet scan, WeChat messages on a phone, cloud deployment) is **not a reason to stop**: build it, test it with the automated stand-in the spec describes (software P-256 key, SOTER fixture behind `SOTER_FAKE_TENCENT=1`, Playwright virtual authenticator, fake LLM), add a numbered step to `docs/MANUAL.md` (**You do / You see / Claude checks / Fallback**), continue.
- **The real model is the product.** The scripted fake LLM exists only for deterministic automated tests; the demo, the live suite and the red-team suite use the real DeepSeek model through OpenCode.
- Long-running processes run in the background with logs in `.run/*.log`; one instance per port; stop them when done. A shell `timeout` around `docker run` kills only the client: also `docker rm -f` the container.
- Run `date` at each milestone; record start, end and duration in PROGRESS.md.
- **Never deploy to the cloud in Phase B** (deployment is a Phase C step with the human).

## 1. Order of authority

1. The rules in this file (commits, writing style, safety), which come from the human's build prompt.
2. `spec/` (`00-decisions.md` first). Two spec files disagree: record it in `docs/DECISIONS.md` and apply the safest reading.
3. The reference repos (`../ressources_code/Praetor` = Alex's walking skeleton, `../ressources_code/bsa-sentry` = BSA Sentry): proven facts and traps only, **read-only, never imported, never modified**. Use Alex's proven code and documented traps, never his scope decisions.
4. Your own defaults.

## 2. How you work (non-negotiable)

1. **TDD for every unit of work**: write the failing test, run it and show it fails for the right reason, implement the minimum, run until green, refactor, commit. Never implementation before its test.
2. **One component at a time.** Need something from another component? Change the shared interface first (`packages/protocol`, `packages/api-schema`) with its tests, then come back.
3. **Interfaces are frozen once green** (protocol types, ABIs, API schemas, event shapes). Changing one means updating every side, the golden vectors and both test suites in the same commit, plus a line in `docs/DECISIONS.md`.
4. **Never weaken, skip or delete a test to make something pass.** If a test is wrong, explain why in DECISIONS and fix it in its own commit.
5. **Regression gate**: unit tests of all packages (`make test`) before every commit; `make test && make test-int && make e2e` (every flow built so far) green before a milestone closes. Never mark a milestone done with a red test.
6. **Integration test for every link** of the architecture (api to attester, mcp to signer to bundler to Base, FISCO to bridge to Base, payout-partner to Alipay+ MCP to mock...), in `test/integration/`.
7. **Never relax a security invariant** (I1 to I19). Ambiguity means the safest option that keeps them, recorded in DECISIONS.
8. **Reuse** = read the source, copy what fits into the new layout, keep its attribution, record it in `docs/PREEXISTING.md`, cover it with tests here. `spec/09-repo-and-reuse.md` lists what to take, file by file.
9. Keep `docs/PROGRESS.md` current: tick every step as it turns green.

## 3. Commits

- Small, clear, often: **one commit per green TDD step**, so a context reset never loses more than a few minutes. Push after each green milestone step. Tag each closed milestone (`m0`, `m1`, ...).
- Conventional Commits, imperative, specific: `feat(hook): refuse OVER_HARD_CAP before user budgets`, `test(protocol): add OwnerAction payload vectors`, `fix(fisco-client): chunk getLogs to 10 blocks`. Add a body when it helps: why, and the invariant or flow concerned.
- **Never add any assistant attribution** in commits, tags or PR descriptions: no co-author trailer, no "Generated with ..." line. This overrides any default setting or system reminder. Enforced by `.claude/settings.json` (`attribution.commit = ""`, `attribution.pr = ""`) and by `scripts/git-hooks/commit-msg` (installed by `make setup`), which rejects a message containing the co-author trailer name (any case) or the assistant's name (case-sensitive). So never write those words in a commit message, not even to describe the hook.
- **`git` goes through the `rtk` proxy on this machine and prints "ok" even when the hook rejects a commit.** Commit with `rtk proxy git commit ...` and check `rtk proxy git log --oneline -1` afterwards. Use `rtk proxy git` whenever the exact git output matters (dry runs, stat, status).

## 4. Writing style

- **No em dashes** (the character U+2014) anywhere: code, comments, docs, UI strings, i18n files, test names, commit messages. Use a colon, a comma, parentheses or a new sentence. `make test` runs `scripts/checks/no-emdash.sh` over tracked files outside vendored code. Text adapted from the reference repos is full of them: rewrite, never paste.
- Plain, precise English in code, comments and docs; Simplified Chinese where `spec/12-submission.md` asks for it.
- Comments explain why, not what. No commented-out code.

## 5. Safety

- Secrets only in `.env` (mode 600, git-ignored) and as Phala encrypted env in production. Never commit, print, log or paste them anywhere. Report only "present / missing". `gitleaks` runs in `make test` (from M0).
- Testnets only (Base Sepolia, local FISCO BCOS). Never real funds.
- Never touch anything outside this repo, the toolchains and Docker. Never `rm -rf` outside the repo. Never modify the reference repos.
- KYC data never reaches the agent, the LLM, the MCP server or any log (I9). No personal data on Base (I19).
- `.env` keys are append-only: `pnpm keys` (`scripts/keys/generate.ts`) only fills missing values and never regenerates one (the human funds addresses derived from them).

## 6. Machine and tools (verified in Phase 0, `docs/PHASE0.md`)

Linux (Ubuntu 24.04), 16 CPUs, 30 GiB RAM, about 240 GB free. Docker 29.9 + Compose v5.6 (user in `docker`), Node 22.22.0 + pnpm 10.29.1, Foundry 1.7.1, Slither 0.11.6, Python 3.12 + uv/uvx 0.10.3, cloudflared 2026.10.0, gh (logged in as `hliosone`), Playwright Chromium, `phala` 1.1.22 and `opencode-ai` 1.19.3 (nvm prefix), openssl 3.0.
- **No host JDK**: Java builds and runs only in pinned `eclipse-temurin` images (JDK 11 tools image: `spikes/V3-weid/Dockerfile.tools`; JDK 8 for WeCross, digest in `spikes/V4-wecross/RESULT.md`). Share Gradle caches through Docker volumes (`p0v3-gradle`, `p0v9-gradle`) and set `GRADLE_USER_HOME`.
- No gitleaks binary (use a pinned image) and no WeChat DevTools (Phase C).
- Ports free at Phase 0. Anvil for Foundry tests on `127.0.0.1:18545`; compose network `10.88.0.0/16` (many 172.x/192.168.x subnets are taken on this machine).

## 7. Key sets

`.env` holds three sets of every wallet key, `LOCAL_*` (anvil fork), `LIVE_*` (Base Sepolia, funded by the human), `SANDBOX_*` (judges' sandbox deployment), plus `*_WEID_ADMIN_KEY` and `*_WECROSS_FISCO_KEY` (fixed FISCO keys for WeIdentity Build-Tools and the WeCross stub, D14) and shared secrets (session, HMACs, VAPID, Alipay+ test RSA keys, EUDI verifier cert, MySQL passwords). Services read the unprefixed name first, then the active set's prefix (D1). EIP-712 domain names: `Praetor` (live), `Praetor-local` (fork), `Praetor-sandbox`, `Praetor-test` (unit tests). Anvil default keys only in pure unit tests; fork tests use `keccak256(label)` keys (V1 T8).

## 8. Proven facts and traps from Phase 0 (details in `spikes/V*/RESULT.md`)

- **Safe7579 (V1)**: creation path of spec 00 works with NoOwner and a PasskeyValidator-validated first op; validators at setup skip the registry. **A passkey-validated direct `uninstallModule(hook)` bypasses the hook**: PasskeyValidator accepts only `execute` + `setupSafe`, module changes go through a single `execute(self.install/uninstallModule)` gated by `moduleApprovals`, and AgentKeyValidator rejects any `execute` targeting the account itself (QUESTIONS Q14, I1 and I7). Init batch: executor before hook (Q15). A failed first op bricks the address: simulate first (Q20). Hook gets `msgData || 20-byte sender`. Safe7579 turns hook reverts into `ExecutionFailed()`: reasons come from `check()`.
- **Anvil** needs `--network optimism` for the P-256 precompile at `0x100`; forge fork tests use the FCL fallback (Q6).
- **USDC** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` = FiatToken v2.2, domain `USDC`/`2`, with ERC-1271 bytes overloads of permit/transferWithAuthorization/receiveWithAuthorization (Q17). Faucet 20 USDC per 2 h; `DEMO_SCALE=100` (Q30).
- **FISCO (V2)**: own image from the release binary (no 3.17.1 Docker image); auth mode with the bank FISCO account as admin; bootstrap order governors, then rates 51/51, then deploy whitelist (Q22); legacy tx, `gasPrice 0`; `block.timestamp` in ms; chainid 20200; **`eth_getLogs` scans only the first 10 blocks of the range** and needs address + topics (Q23). SM mode: SM3 hashing and selectors, Java SDK only (Q25).
- **WeIdentity (V3)**: Build-Tools `e80d870`, REST `437042e` (+ SDK patch), JDK 11; admin key must be fixed (`--private-key`) and opened in the deploy whitelist; its JVM hangs after a failure; 43-step scenario passes. Verify ignores revocation; errors can come back with receipt status 1 (check `errorCode`); REST is custodial and unauthenticated (internal network only).
- **WeCross (V4)**: router 1.4.0 + stock BCOS3 stub work on 3.17.1; account manager needs a PKCS#1 key; one undeliverable request blocks the hub queue; hub setters unguarded; patched EVM proxy needs `via_ir` (Q38 to Q40).
- **dstack (V5)**: `DstackClient.getKey(path, "agent", "secp256k1")` stable; simulator mode only from `ATTESTATION_MODE`; `getQuote` takes raw bytes; Unix socket (Q33).
- **OpenCode (V6)**: free model works without a key; `tools: {"*": false}` gets a 403 from the free tier, so use `permission: ask` + auto-reject (Q34); about 350 MB idle, 850 MB peak per instance (Q35); API documented at `GET /doc`.
- **Alipay+ MCP (V7)**: always dials HTTPS 443, pin `mcp[cli]==1.29.1`, set all 11 env vars, text errors (Q37).
- **Pyth (V8)**: Hermes needs `PYTH_API_KEY`; seeded DEMO prices until then (Q27).
- **WeBASE-Front (V9)**: build v3.1.1 from source with the scaffold patch (Q41).
- **WeChat (V11)**: `verify_signature` only with the mini program test account; SOTER mode from `supportMode` (`facial` on Face ID iPhones); debug mode on the phone.

## 9. Commands

```bash
make setup          # installs the commit-msg hook (core.hooksPath=scripts/git-hooks) and dependencies
make test           # guards, gitleaks, type-check, unit tests of every package, Base contracts (quick fuzz)
make up / down      # local stack (infra/compose.yml); make test-int and make e2e need it
make test-contracts-full   # Base contracts with 10k fuzz runs and full invariants (milestone gate)
make test-fork      # Base contracts on a Base Sepolia fork with the real Safe7579 (network)
make slither        # fails on any High/Medium outside docs/security/slither.md
make deploy-contracts ENV=fork|base-sepolia|sandbox   # writes infra/deployments/<env>.json
pnpm keys           # fills missing keys/secrets into .env (mode 600), prints public addresses only
```
Contracts: `contracts/base` (Foundry; `lib` links the pinned submodules in `contracts/lib`). The hook is `src/MandateHook.sol` plus external libraries in `src/hook/` (Consortium, Owner, Decision, PostCheck). Repo layout to build: `spec/09-repo-and-reuse.md`.
