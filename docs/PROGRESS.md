# Progress

Single source of truth for where the build stands. After a context reset: read `CLAUDE.md`, this file, run the tests, resume at the first unchecked item.

## Now

**Phase B done** (go received 2026-10-17 07:02 UTC, no answers: all QUESTIONS defaults apply, D3). M0 to M18 are closed: the build and every gate on the local fork, the red team (100 attacks, 0 executed), the live evidence run on Base Sepolia (D96) and the production rehearsal (D90). The teammate's iPhone issues #1 to #11 are fixed. Next: Phase C with the human, from step 1 of `docs/MANUAL.md`.

## Phase 0 (2026-10-17 03:30 to 04:30 UTC)

- [x] Read `spec/` (00 to 12) and the reference reports
- [x] Environment check (`docs/PHASE0.md` section 1)
- [x] Commit guard: `.claude/settings.json` attribution off, `scripts/git-hooks/commit-msg` + test, `make setup`
- [x] `scripts/keys/generate.ts` + tests; keys generated into `.env` (600), three sets
- [x] Spikes V1 to V11 (`docs/PHASE0.md` section 2, `spikes/V*/RESULT.md`)
- [x] `docs/QUESTIONS.md` (45 questions with defaults, funding list, keep-awake step)
- [x] Repo `CLAUDE.md`
- [x] Commit, push, stop with the PHASE 0 DONE message

## Phase B

- [x] 1. Read the answers, check them against the spec, record them in `docs/DECISIONS.md`, update `spec/` only where an answer changes a decision (note at the top of the changed file; expected: spec 03 for Q14/Q16, spec 00 and 06 for Q15, spec 05 for Q34), update `CLAUDE.md` if needed, commit.
- [x] M0 Monorepo scaffold, Makefile, compose skeleton (anvil fork with `--network optimism`, MySQL, Caddy), CI scripts, lint, gitleaks, docs skeleton check, attribution check (gate: `make up`, `make test` green; a test commit with a co-author trailer is rejected)
- [x] M1 `packages/protocol` (gate: vectors green on TS and Solidity; interface frozen)
- [x] M2 Base contracts (gate: forge unit/fuzz >= 10k/invariants, hook coverage >= 90%, Slither explained)
- [x] M3 userop, chain, bundler (gate: fork integration I1, I7, I11, gas snapshot)
- [x] M4 FISCO chain + contracts + fisco-client (gate: 4-node integration)
- [x] M5 member services governance, bridge-relayer, seed script (gate: F9 steps 1, 2, 5, 6, 7 + FROZEN refusal)
- [x] M6 identity (gate: 43-step scenario, PersonKYC, AgentMandate 2 sigs, revocation)
- [x] M7 TEEs on the simulator (gate: integration, I13)
- [x] M8 mcp, agent-runner + OpenCode (fake LLM), scheduler, oracle-feeder (gate: e2e F4, F5)
- [x] M9 api, notifier (gate: e2e F1, F2, F3, F6)
- [x] M10 standing orders, payout partner, Alipay+/WeChat Pay mocks (gate: e2e F7)
- [x] M11 audit writer, anchors, verify, camt.053 (gate: e2e F8, XSD)
- [x] M12 WeCross router + EVM stub, watchdog (gate: integration + e2e F9 with `BRIDGE=wecross`): integration 16/16 files and e2e 41/41 on a fresh fork, WeCross the transport, 2026-10-17 23:30 UTC
- [x] M13 web app, Phone3D, i18n, PWA, sandbox, console (gate: Playwright F1 to F9, screenshots, axe): journey F1 to F10, sandbox, 34 screenshots with axe, 15/15 green on 2026-10-18; the sandbox is the interim one (D48, D73), web push in (M13 PWA)
- [x] M14 mini program (gate: logic tests, MANUAL steps) (built by a parallel agent, D44; phone steps in MANUAL 5)
- [x] M15 F10 + Guomi smoke + whole suite (gate: e2e F1 to F10 on fork): e2e 41/41 with F10 3/3 (rotation, stop, recovery scheduled and cancelled), the web journey F1 to F10 15/15, the 48 h warp (`executeRecovery`: only the new passkey signs in, the agent key revoked) and the Guomi smoke (agent), all on fresh forks, 2026-10-18 00:35 UTC
- [x] M16 live run + red team (gate: EVIDENCE.md, "N attacks, 0 executed"): red team 85 scripted, 3 global and 12 real-model attacks, 0 executed (`docs/security/redteam.md`); the evidence flows C0 to F8 on Base Sepolia with Pyth prices, 14 distinct Base transactions (21 links) in `docs/EVIDENCE.md` (D96), 2026-10-18 05:35 UTC
- [x] M17 security pack + docs EN/中文 (parallel agent, D44; refreshed at the end of Phase B)
- [x] M18 deployment rehearsal (gate: smoke on `compose.prod.yml`): `make rehearsal` on the fork, smoke F1, F5, F8 16/16 and the five prod refusals, 2026-10-18 04:50 UTC (D90); the cloud deployment is Phase C
- [x] Final gate before the public server (2026-10-19, fork only, D105): integration 18 files / 76 tests, api e2e 42/42 (after the F2 test fix; 42/42 again after the global red team), web journey and shots 14/14 with the sandbox green on its rerun (15/15 on the final code), the 48 h warp 1/1; F4 now proves the owner-approved rebalance (D103 fix 1); red team scripted 85, global 3, real model 12, 0 executed; I19 fork scan clean; the deck's screenshots re-shot with Lin's account (`apps/web/e2e/deck.spec.ts`)
- [x] The three morning fixes verified in the browser (2026-10-19, fork only, on 4f8f7b7 with the api image and the web build checked fresh): the web suite 15/15 on a fresh fork, the sandbox's audit check verified on its first pass (the Base anchor read first, 2843836); the deck's shots re-taken on a second fresh fork, 6/6 with axe: the mandate form reads "Keep at least (USDC)" once (cf7f632) and the agent chat at 1440 px shows the newest reply (4f8f7b7; the 390 px shot, taken by narrowing the same page, keeps the old scroll position, so the reply sits just below the box there)

## Timings

| Step | Start (UTC) | End (UTC) | Duration |
|---|---|---|---|
| Phase 0 | 2026-10-17 03:30 | 2026-10-17 04:30 | about 1 h |
| Phase B step 1 | 2026-10-17 07:02 | 2026-10-17 07:04 | 2 min |
| M0 | 2026-10-17 07:04 | 2026-10-17 07:12 | 8 min |
| M1 | 2026-10-17 07:12 | 2026-10-17 07:24 | 12 min |
| M2 | 2026-10-17 07:24 | 2026-10-17 08:18 | 54 min |
| M3 | 2026-10-17 08:18 | 2026-10-17 08:57 | 39 min |
| M4 | 2026-10-17 08:57 | 2026-10-17 09:19 | 22 min |
| M5 | 2026-10-17 09:19 | 2026-10-17 10:07 | 48 min |
| M6 | 2026-10-17 10:07 | 2026-10-17 11:16 | 69 min |
| M7 | 2026-10-17 11:16 | 2026-10-17 12:02 | 46 min |
| M8 | 2026-10-17 12:02 | 2026-10-17 14:40 | 2 h 38 min |
| M9 | 2026-10-17 14:40 | 2026-10-17 15:37 | 57 min |
| M10 | 2026-10-17 15:37 | 2026-10-17 16:17 | 40 min |
| M11 | 2026-10-17 16:17 | 2026-10-17 17:26 | 69 min |
| M14 (agent) | 2026-10-17 19:24 | 2026-10-17 20:26 | 62 min |
| M15 Guomi smoke (agent) | 2026-10-17 19:24 | 2026-10-17 20:27 | 63 min |
| M17 (agent) | 2026-10-17 19:24 | 2026-10-17 20:11 | 47 min |
| M12 | 2026-10-17 17:26 | 2026-10-17 23:30 | 6 h 04 min (WeCross plus the fixes its gate found: watchdog clock, anchor resumption, early delivery records) |
| M13 | 2026-10-17 17:30 | 2026-10-18 00:18 | 6 h 48 min (overlapping M12; plus the console's shared proposals, client digest checks, sandbox, push) |
| M15 | 2026-10-17 23:30 | 2026-10-18 00:35 | 65 min (F10 itself built during M12 and M13; the warp gate and its clean-up) |
| M18 | 2026-10-18 04:14 | 2026-10-18 04:50 | 36 min (three fixes the rehearsal found: scheduler, refusal networking, api refusal order) |
| M16 | 2026-10-18 00:35 | 2026-10-18 05:35 | 5 h (red team, its fixes D86 to D88, then the live run and the fixes it found D92, D96) |
| Final gate (D105) | 2026-10-19 01:42 | 2026-10-19 03:25 | 1 h 43 min (two fixes found by it: F2's app id in the test, the chat's keyboard access in the web app) |
| Morning fixes check | 2026-10-19 03:39 | 2026-10-19 04:02 | 23 min (web suite, deck shots, unit gate) |
