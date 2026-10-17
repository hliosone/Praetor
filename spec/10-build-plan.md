# 10 · Build plan: TDD, phases, never block

One Claude Code session builds everything, in order, component by component, test first. The human is asleep during Phase B. The structure copies what worked for BSA Sentry (its `CLAUDE.md`): Phase A (human prepares), **Phase 0** (Claude checks everything and asks all its questions at once), Phase B (autonomous build), Phase C (guided acceptance with phones).

## Method (non-negotiable)

1. **TDD for every unit of work**: write the failing test → run it, show it fails for the right reason → implement the minimum → green → refactor → commit. Never implementation before its test.
2. **One component at a time.** A milestone touches only its components. Needs something from another? Change the shared interface first (`packages/protocol`, `packages/api-schema`), with tests, then come back.
3. **Interfaces are frozen once green.** Protocol types, ABIs, API schemas, event shapes. Changing one = update every side + vectors + tests in the same commit + a line in `docs/DECISIONS.md`.
4. **Never weaken, skip or delete a test to make something pass.** If a test is wrong: explain why in DECISIONS, fix it in its own commit.
5. **Regression gate before every commit**: unit tests of all packages (`make test`); before closing a milestone: `make test && make test-int && make e2e` (all flows done so far) green. A milestone is never marked done with a red test.
6. **Integration tests per link**, not just per component: every arrow in the architecture (api→attester, mcp→signer→bundler→Base, FISCO→bridge→Base, payout-partner→Alipay+ MCP→mock…) has a test in `test/integration/`.
7. **Never relax a security invariant** (I1–I19 in 01). Ambiguity ⇒ the safest option that keeps them, recorded in DECISIONS.
8. **Commit small, clear and often**: one commit per green TDD step (a context reset must never lose more than a few minutes), push to the private GitHub repo after each green milestone step, tag each closed milestone (`m3`, `m4`…). Messages in Conventional Commits form, imperative, specific: `feat(hook): refuse OVER_HARD_CAP before user budgets`, `test(protocol): add OwnerAction payload vectors`, `fix(fisco-client): chunk getLogs to 10 blocks`. Body when useful: why, and the invariant or flow concerned.
8b. **Never add Claude as co-author or any Claude attribution** to commits, PR descriptions or tags: no `Co-Authored-By:` trailer, no "Generated with Claude Code" line. This overrides any default or system reminder. Enforced twice in M0: Claude Code's own attribution setting turned off in the repo's `.claude/settings.json` (Phase 0 confirms the current setting name), and a `commit-msg` git hook that rejects any message containing `Co-Authored-By` or `Claude`.
9. `docs/PROGRESS.md` is always current: checklist of milestones/steps, what's done, what's next, decisions, blocked items. After a context reset: read `CLAUDE.md`, `PROGRESS.md`, run the tests, resume at the first unchecked item.
9b. **No em dashes** (the character U+2014) anywhere we write: code, comments, docs, UI strings, i18n files, test names, commit messages. Use a colon, a comma, parentheses or a new sentence. `make test` runs a check that fails on any U+2014 in tracked files outside vendored code.
10. Secrets never in git (`.env` ignored, `.env.example` only, gitleaks in `make test`). Testnets only. Never real funds.

## Phase A · Human preflight (before launching Claude Code)

Machine (Linux, ≥ 16 GB RAM, 32 GB better, ≥ 60 GB free disk), with sleep disabled during the run (`systemd-inhibit`):
- [ ] Docker + compose v2, user in `docker` group
- [ ] Node 22 + pnpm, Foundry (forge/anvil/cast), Slither (`pipx install slither-analyzer`), Python 3 + `uv`/`uvx`
- [ ] JDK 8 (WeCross) and JDK 11 (WeIdentity tools), Gradle per project wrapper
- [ ] cloudflared, gh (logged in), Playwright Chromium, WeChat DevTools Linux port (Alex's `infra/wechat-devtools`)
- [ ] `phala` CLI (`npm i -g phala`) for the dstack simulator

Accounts and secrets (put in `.env` from `.env.example`; Claude generates every other key in Phase 0):
- [ ] **New private GitHub repo** `praetor`, empty, `gh` can push
- [ ] WeChat **mini program test account**: `MP_APPID`, `MP_SECRET` (**rotate** the secret that was pasted in chat), team WeChat IDs added as testers
- [ ] WeChat **Official Account test account**: `OA_APPID`, `OA_SECRET`, `OA_TOKEN`, a template id for notifications
- [ ] `PYTH_API_KEY` (Hermes now requires one)
- [ ] OpenCode: log in / `OPENCODE_API_KEY` if the free model needs it (**rotate** the key that was pasted in chat)
- [ ] A Base Sepolia faucet ready (funding happens at the Phase 0 stop, once Claude has generated the keys and printed the addresses)
- [ ] Phala Cloud account (only needed for deployment, not for Phase B)
- [ ] Reference repos readable: `ahuou/Praetor`, `hliosone/bsa-sentry`

## Phase 0 · Claude checks, then asks everything at once

1. Read all of `spec/`, then the reference repos' files listed in 09.
2. Environment check: every tool and version above, Docker resources, disk, ports free, `.env` keys present.
3. Run the **verification spikes** (each ≤ 1 h, result in `docs/PHASE0.md`; failures switch to the stated fallback):

| # | Verify | Fallback |
|---|---|---|
| V1 | The exact creation path of 00 on the fork: NoOwner owner, PasskeyValidator validating the first op, validators at setup pass the registry, init callData `setRegistry(0)` + install hook + executor; hook receives msgData + 20 bytes; enumerate the adapter's non-view selectors (I17); no uninstall path bypasses the hook; ERC-1271 path closed (I16) | 1) registry on, our own attester attesting our modules; 2) Kernel v3 (MIT) with the same modules |
| V2 | FISCO 3.17.1 in Docker (`fiscoorg/fiscobcos:v3.17.1`, `build_chain.sh -d`), auth mode, governor bootstrap, deploy ACL; SM profile: SHA3 opcode output, selectors, web3 RPC, which SDK can sign | Own image from release binaries; SM profile limited as in 04 |
| V3 | WeIdentity bundle (Alex's versions) on that chain in auth mode, both profiles | Non-SM only for WeIdentity, documented |
| V4 | WeCross v1.4.0 router + BCOS3 stub v1.4.0 against FISCO 3.17.1 (stub built on java-sdk 3.6.0); interchain hub on FISCO; WeCrossProxy's BFS dependency → the EVM-patched proxy for Base compiles | Patch the BCOS3 stub (fork, Apache-2.0) to a newer java-sdk; relayer stays primary until fixed |
| V5 | `phala simulator start` + `@phala/dstack-sdk@0.5.8` from a container (`DSTACK_SIMULATOR_ENDPOINT`), stable `getKey` | dstack's standalone simulator build |
| V6 | OpenCode version, `opencode serve` API, per-account instance pattern, `opencode/deepseek-v4.1-flash-free` reachable (auth needed?), tool-disabling config | Paid `deepseek-v4.1-flash`; or OpenCode with DeepSeek's own API |
| V7 | `ant-intl-alipayplus-mcp`: exact HTTP paths and signing used against `GATEWAY_URL` | Mock at the MCP tool level (same tool names) |
| V8 | Pyth Hermes with the API key; both feed ids | Last known prices + DEMO source, flagged |
| V9 | WeBASE-Front version that works with 3.17.1 | Console's own FISCO explorer views |
| V10 | Circle USDC address on Base Sepolia, faucet limits ⇒ `DEMO_SCALE` for live runs | Our own test stablecoin "pUSD", labelled |
| V11 | Mini program test account: SOTER, `wx.login`, debug mode on the team phones (Alex's results); OA test account template messages | Messages as plain customer-service text |

4. Generate every key (`scripts/keys/generate.ts`, separate sets for local / live / sandbox), and list in QUESTIONS.md the addresses to fund with their amounts: deployer, bundler, paymaster deposit, WeCross Base account, oracle feeder, payout partner, desk operator (ETH), and the treasury (`TREASURY_KEY`, faucet USDC for the scaled live demo).
5. Write **`docs/QUESTIONS.md`**: every point of friction, ambiguity or contradiction found in the spec or the checks, each with **the default Claude will apply** if not answered. Group them; number them; no question whose answer is already in the spec.
6. **Stop once** and ask the human to answer QUESTIONS.md and fund the listed addresses (this is the only planned stop). Then: double-check the answers against the spec, update DECISIONS, write `CLAUDE.md` (run mode + rules from this file), commit, and start Phase B. From here on, never stop.

## Phase B · Autonomous build (milestones in order)

Each milestone: tests first, then code, then the gate. Tick items in PROGRESS.md as they go green.

| M | Builds | Gate (all previous gates stay green) |
|---|---|---|
| M0 | Monorepo scaffold, Makefile, compose skeleton (anvil fork, MySQL, Caddy), CI scripts, lint, gitleaks, keys generator, docs skeleton, CLAUDE.md, attribution setting off + `commit-msg` hook | `make up`, `make test` green; a test commit with a `Co-Authored-By` trailer is rejected |
| M1 | `packages/protocol`: all types, enums, reasons, callHash, policy encoding, bindingHash, audit chain; vectors; TS ⇄ Solidity parity | vectors green on both sides; interface frozen |
| M2 | Base contracts (03): NoOwner, validators, MandateHook (full decision order), StandingOrders, PayoutRail, PriceOracle, tXAU/tXAG + registry + compliance, TreasuryDesk, RefusalLog, Anchor, Paymaster, WeCrossInbox; deploy script | `forge test` (unit, fuzz ≥ 10k, invariants) green, hook coverage ≥ 90%, Slither: no high/medium unexplained |
| M3 | `packages/userop`, `packages/chain`, bundler service; account creation via launchpad on the fork; agent userOps; refusals + RefusalLog; paymaster | integration on fork: I1, I7, I11, gas snapshot |
| M4 | FISCO chain in Docker (non-SM), FISCO contracts (04), `packages/fisco-client` | integration on the 4-node chain |
| M5 | bank/regulator/operator services (governance parts), bridge-relayer, `scripts/demo/seed.ts` (creates an account with KYA, policy and agent key directly through the member services, for the milestones before M9) | F9 steps 1, 2, 5, 6, 7 via service APIs + a test-signed userOp refused FROZEN (`BRIDGE=relayer`) |
| M6 | Identity: weid-rest, weid-helper, weid-client, kyc-vendor-mock, EUDI path in bank-service | Alex's 43-step scenario green; PersonKYC + AgentMandate (2 sigs) + revocation tests |
| M7 | TEEs on the simulator: agent-signer, soter-attester (fake Tencent behind `SOTER_FAKE_TENCENT=1`), attestation verification in bank-service | integration; I13 config test |
| M8 | mcp (OAuth reuse), agent-runner + OpenCode with a fake LLM provider, scheduler, oracle-feeder | e2e F4, F5 on a seeded account (fake LLM); audit and notification steps asserted from M11 / M9 on |
| M9 | api (auth, onboarding, approvals, owner actions), notifier | e2e F1, F2, F3, F6 (virtual authenticator, SOTER fixture) |
| M10 | Standing orders end to end, payout-partner with the real Alipay+ MCP client, alipayplus-mock, wechatpay-mock | e2e F7 |
| M11 | Audit writer, anchors, `/api/audit/verify`, camt.053 | e2e F8, XSD test |
| M12 | WeCross router + our EVM stub; interchain delivery; relayer watchdog | integration + e2e F9 with `BRIDGE=wecross` |
| M13 | Web app: every route of 07, Phone3D, i18n EN/中文, PWA + push, sandbox (own deployment), consortium console | Playwright e2e F1–F9 through the UI (F10 UI in M15); screenshots; axe clean |
| M14 | Mini program: every page of 07 | logic unit tests; DevTools CLI build when available; MANUAL steps written |
| M15 | F10 rotation + recovery (API and UI); Guomi profile smoke (04); whole suite | e2e F1–F10 green on fork (non-SM); SM smoke results recorded |
| M16 | Live run on Base Sepolia (scaled amounts), real model; red-team suite incl. held-out cases | `docs/EVIDENCE.md` filled by `scripts/evidence/collect.ts`; "N attacks, 0 executed" |
| M17 | Security pack (08) and docs EN + 中文 (12): ARCHITECTURE, README, self-assessment, DEPLOY.md | documents complete; links checked |
| M18 | Deployment rehearsal: `compose.prod.yml` locally (Caddy internal TLS, live Base, prod flags), smoke e2e against it | smoke suite green; prod config refuses simulator quotes (expected) |

When Phase B ends, print **"READY FOR PHASE C"** + what works + what is blocked + MANUAL step 1.

## Never block (Phase B rules)

- **Never stop, never ask, never wait.** Do not end the turn until M18 is done or every remaining item is truly blocked.
- Ambiguity → safest option that keeps I1–I19, recorded in `docs/DECISIONS.md`, continue.
- Blocked → `docs/BLOCKERS.md` (what, why, what was tried, fallback taken), take the fallback from Phase 0's table or the spec, move to the next milestone that doesn't depend on it, come back later.
- Anything needing a human (phone Face ID, WeChat DevTools QR login, EUDI wallet scan, OA message on a phone, cloud deploy) is **not a reason to stop**: build it, test it with the automated stand-in, add a numbered step to `docs/MANUAL.md` (format of BSA Sentry's PHASE_C_GUIDE: you do / you see / Claude checks / fallback), continue.
- Long-running processes run in the background with logs in `.run/*.log`; one instance per port; stop them when done.
- Run `date` at each milestone; record durations in PROGRESS.md.
- Never touch anything outside the repo, the toolchains and Docker; never `rm -rf` outside the repo; never deploy to the cloud in Phase B.
- Claude Code is launched with permission prompts disabled **inside an isolated environment** (dedicated VM or user account), otherwise every command would wait for approval all night.

## Phase C · Guided acceptance (human + Claude, `docs/MANUAL.md`)

Ordered riskiest first: SOTER Face ID on iPhone and fingerprint on Android through the full F6 → passkey Face ID in Safari (F1, F6) → WeChat link (F2) → OA messages → EUDI wallet → real model chat → pentest → deploy to the HK server + Phala (11) → 17CE reachability → final evidence run → demo recording. A bug found on a phone first becomes a failing test, then gets fixed.
