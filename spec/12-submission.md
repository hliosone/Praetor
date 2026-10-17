# 12 · Submission

## Scoring we build for

Task completion 40% · Security & compliance 30% · Innovation & interaction 30% · on-chain challenge bonus 0–5.

## The six deliverables

| Deliverable | File / output | Built in |
|---|---|---|
| Technical documentation (architecture, core algorithms, security design) | `docs/ARCHITECTURE.md` + `docs/zh-CN/ARCHITECTURE.md` (generated from `spec/` + the architecture page, rewritten for judges) | M17 |
| Deck ≤ 10 min | Made outside the build (Slides), from `docs/ARCHITECTURE.md` and the demo | after Phase C |
| Demo video ≤ 5 min | Recorded in Phase C following the storyboard below, EN voice + 中文 subtitles | Phase C |
| Source code + README + deployment + tests | repo, `README.md` / `README.zh-CN.md`, `docs/DEPLOY.md`, `make test`, `make e2e` | all |
| Security self-assessment | `docs/security/SELF_ASSESSMENT.md` (+ zh-CN): tier table, invariants with their tests, threat model, known risks, red-team results, Slither, pentest, TEE checklist | M17 |
| Execution evidence | `docs/EVIDENCE.md`: per flow, every Base Sepolia tx hash (executed **and refused**) with BaseScan links, FISCO tx hashes with WeBASE links, AuditLog head + Base anchor | M16, refreshed after deploy |

## Chinese

Simplified Chinese for: README, ARCHITECTURE, SELF_ASSESSMENT, DEPLOY, UI strings (web app, mini program, console), agent answers (the agent replies in the user's language), video subtitles, deck titles. Technical identifiers stay in English. Terms: 智能体钱包 (agent wallet), 授权委托 (mandate), 监管冻结 (regulator freeze), 联盟链 (consortium chain), 分级授权 (approval tiers), 国密 (Guomi).

## Licences and IP

- Repo: no open-source licence; `LICENSE` file states "Copyright © 2026 the Praetor team. All rights reserved. Source made available for evaluation by FinTechathon 2026 organisers and judges." The rules give organisers non-exclusive, non-commercial promotion rights; IP stays with the team.
- `THIRD_PARTY_LICENSES.md` + `NOTICE` (list in 09). `docs/PREEXISTING.md`: BSA Sentry code reused (with its authors' agreement) and Alex's skeleton, with dates.
- GPL boundary: no GPL source in our tree (CI check greps SPDX headers in `contracts/` and `packages/`).

## Demo storyboard (5 min, real transactions)

1. **0:00 Hook** (20 s): "Your money, managed by an AI agent, bounded by rules no AI can break, with a regulator holding the brakes." Phone3D landing.
2. **0:20 Onboarding** (40 s, pre-recorded fast-forward): Face ID passkey → wallet created (BaseScan) → demo KYC → agent created in a TEE (measurement verified by the bank) → mandate signed (passkey + bank, FISCO tx).
3. **1:00 Autonomous rebalancing** (50 s): demo price shock gold +20% → scheduler wakes the agent → sells ≈650 USD of tXAU → BaseScan tx, mini program notification, rings back in band.
4. **1:50 Human in the loop, inside WeChat** (50 s): "pay Café Lumen 300" → refused on-chain (UNKNOWN_PAYEE, tx) → WeChat notification → mini program → **Face ID** → executed (tx), "Approved ✓".
5. **2:40 Attack** (35 s): prompt injection to a sanctioned address → refused, SANCTIONED computed on-chain by RefusalLog (tx) → "40 attacks, 0 executed" slide flash.
6. **3:15 Recurring payment** (25 s): rent standing order → PayoutRail → Alipay+ (mock, labelled) settlement → audit links.
7. **3:40 Regulator freeze** (45 s): console → one signature → WeCross carries it from FISCO to Base → next agent action refused FROZEN (tx) → mini program turns red → loosen needs 2 of 3.
8. **4:25 Audit** (25 s): AuditLog hash chain on FISCO, anchor on Base, "Verified ✓", camt.053 export.
9. **4:50 Close** (10 s): three pillars Autonomous / Bounded / Regulated.

## Business model (one slide)

Praetor runs each user's agent for them, financed by a subscription; bringing your own MCP agent stays possible. The bank and the regulator are consortium members, not customers of the agent.

## Pitch line

**Praetor: self-driving money; the regulator holds the brakes.** Autonomous (the agent rebalances and pays on its own), Bounded (an on-chain mandate, default deny, bank caps, Face ID inside WeChat for anything unusual), Regulated (a WeBank-stack consortium with real identity, sanctions, audit and a one-vote freeze that reaches Base through WeCross).
