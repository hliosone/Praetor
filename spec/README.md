# Praetor: build specification

> **Self-driving money. The regulator holds the brakes.**
> FinTechathon 2026 (Shenzhen, WeBank × Tsinghua PBCSF), International Track, Topic F "Agent Wallet".

This folder is the single source of truth for building Praetor. Claude Code reads it before writing any code. The architecture page ("Praetor architecture" artifact) is the visual summary of the same decisions; when this folder and the page disagree, **this folder wins**, and the mismatch goes into `docs/DECISIONS.md`.

## What Praetor is (one paragraph)

An AI agent manages a user's portfolio (USDC, tokenized gold tXAU, tokenized silver tXAG) and pays their bills on its own, from an ERC-4337 smart account on **Base Sepolia**. Every call the account makes passes an on-chain **Mandate hook** (ERC-7579) that enforces the user's rules and the bank's caps, default deny. A **FISCO BCOS** consortium (bank, regulator, operator) holds the authority: identity (WeIdentity), approved assets, sanctions, the agent's status, and an append-only audit log. Its decisions reach Base as member signatures that the hook verifies itself, carried by **WeCross** (our new EVM stub) or by a fallback relayer, so nothing in between is trusted. Humans approve what the agent may not do alone with **Face ID inside WeChat** (SOTER, co-signed by an attester in a TEE) or a **passkey** checked on Base. The agent's key lives in a **TEE** (Phala dstack, Intel TDX). One freeze vote from the regulator stops the agent at contract level.

## Reading order

| # | File | What it fixes |
|---|---|---|
| 00 | [00-decisions.md](00-decisions.md) | Every decision already taken, incl. where we diverge from the reference repo. Read first. |
| 01 | [01-system.md](01-system.md) | Components, zones, keys, trust model, tiers T0–T4, invariants |
| 02 | [02-protocol.md](02-protocol.md) | The shared interface: EIP-712 types, reason codes, `callHash`, events, policy encoding, vectors |
| 03 | [03-contracts-base.md](03-contracts-base.md) | Base Sepolia contracts, function by function, and the hook's decision order |
| 04 | [04-contracts-fisco.md](04-contracts-fisco.md) | FISCO BCOS contracts and the consortium message board |
| 05 | [05-services.md](05-services.md) | Every backend service, TEE, WeCross, identity, agent, API endpoints |
| 06 | [06-flows.md](06-flows.md) | The 10 flows end to end, step by step, with the test that proves each step |
| 07 | [07-ui.md](07-ui.md) | Design direction, the 3D phone, every screen of the web app, consoles and mini program |
| 08 | [08-security.md](08-security.md) | Threat model, invariants, red-team suite, known risks, self-assessment structure |
| 09 | [09-repo-and-reuse.md](09-repo-and-reuse.md) | New repo layout, and what to reuse from the reference repos, file by file |
| 10 | [10-build-plan.md](10-build-plan.md) | TDD method, phases A/0/B/C, milestones, test gates, how to never block |
| 11 | [11-environments.md](11-environments.md) | Local = small prod: Docker Compose, env vars, deployments, tunnel, cloud transition |
| 12 | [12-submission.md](12-submission.md) | Deliverables, evidence, Chinese docs, licenses, demo storyboard |

## Reference repos (read-only, never copy blindly)

- **Alex's walking skeleton**: `ahuou/Praetor`. Every *connection* proven (FISCO, Base, Safe7579 + own bundler, passkey on Base, SOTER on iPhone, WeIdentity scenario a–k, MCP transport). Logic is stubbed. Use its **proven code and traps**, not its scope decisions.
- **BSA Sentry**: `hliosone/bsa-sentry`. Our previous hackathon project by the same team: `decide.rs` (policy engine to port), MCP server with OAuth, ISO 20022 camt.053 export, EUDI wallet verifier, the web UI and its 3D device, and the CLAUDE.md run-mode that worked.

## Vocabulary

| Term | Meaning |
|---|---|
| Account / wallet | The user's ERC-4337 Safe7579 smart account on Base Sepolia. Holds USDC, tXAU, tXAG. |
| Hook | `MandateHook`, the ERC-7579 global hook installed on the account. Runs before and after every execution. |
| Policy / mandate | The user's rules (caps, budgets, payees, bands…), stored in the hook, co-signed by the bank. |
| Caps | The bank's limits per risk profile. The hook always applies the stricter of policy and caps. |
| Member | A consortium organisation: bank, regulator, operator. Each has a FISCO account and a secp256k1 "Base signer" key. |
| Attestation | An EIP-712 message signed by member keys, created on FISCO, verified on Base by the hook. |
| callHash | Hash of one exact call (account, chain, target, value, data). Human approvals are bound to it. |
| Owner action | A rule change (T3) authorised by the owner (passkey or SOTER) plus the bank. |
| Agent key | The secp256k1 session key generated and used inside the agent-signer TEE. Validates userOps through `AgentKeyValidator`. |
| Attester | The SOTER attester TEE. Signs `SoterApproval` after Tencent verified a SOTER signature. |
| Binding | Hash of (WeChat app, openid, phone uid, phone cpu_id) linked to an account. Only that WeChat account on that phone can approve via SOTER. |
| T0–T4 | Approval tiers: Never, Autonomous, Human (WeChat SOTER or passkey), Owner + bank, Consortium. |
