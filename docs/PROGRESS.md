# Progress

Single source of truth for where the build stands. After a context reset: read `CLAUDE.md`, this file, run the tests, resume at the first unchecked item.

## Now

**Phase B in progress** (go received 2026-10-17 07:02 UTC, no answers: all QUESTIONS defaults apply, D3). No address funded and no human `.env` value: everything runs on the fork (BLOCKERS B1, B2). Resume at the first unchecked item below.

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
- [ ] M5 member services governance, bridge-relayer, seed script (gate: F9 steps 1, 2, 5, 6, 7 + FROZEN refusal)
- [ ] M6 identity (gate: 43-step scenario, PersonKYC, AgentMandate 2 sigs, revocation)
- [ ] M7 TEEs on the simulator (gate: integration, I13)
- [ ] M8 mcp, agent-runner + OpenCode (fake LLM), scheduler, oracle-feeder (gate: e2e F4, F5)
- [ ] M9 api, notifier (gate: e2e F1, F2, F3, F6)
- [ ] M10 standing orders, payout partner, Alipay+/WeChat Pay mocks (gate: e2e F7)
- [ ] M11 audit writer, anchors, verify, camt.053 (gate: e2e F8, XSD)
- [ ] M12 WeCross router + EVM stub, watchdog (gate: integration + e2e F9 with `BRIDGE=wecross`)
- [ ] M13 web app, Phone3D, i18n, PWA, sandbox, console (gate: Playwright F1 to F9, screenshots, axe)
- [ ] M14 mini program (gate: logic tests, MANUAL steps)
- [ ] M15 F10 + Guomi smoke + whole suite (gate: e2e F1 to F10 on fork)
- [ ] M16 live run + red team (gate: EVIDENCE.md, "N attacks, 0 executed")
- [ ] M17 security pack + docs EN/中文
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
