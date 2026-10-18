# Progress

Single source of truth for where the build stands. After a context reset: read `CLAUDE.md`, this file, run the tests, resume at the first unchecked item.

## Now

**Phase B in progress** (go received 2026-10-17 07:02 UTC, no answers: all QUESTIONS defaults apply, D3). M0 to M15 and M17 are closed on the local fork. The human funded the LIVE deployer and treasury on 2026-10-17 (B1 resolved for live, budget D74); the contracts are on Base Sepolia. Left: the red team on the fork and the live evidence run (M16), the rehearsal (M18). Resume at the first unchecked item below.

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
- [ ] M16 live run + red team (gate: EVIDENCE.md, "N attacks, 0 executed")
- [x] M17 security pack + docs EN/中文 (parallel agent, D44; refreshed at the end of Phase B)
- [ ] M18 deployment rehearsal (gate: smoke on `compose.prod.yml`)

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
