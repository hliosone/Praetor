# 08 · Security

Security & compliance is 30% of the score. Everything below produces evidence that ships in `docs/security/`.

## Threat model (reasonable attackers, not nation states)

| Attacker | Can | Controls |
|---|---|---|
| Prompt injection (merchant text, chat, web content) | Make the LLM call tools with bad arguments | Tools have no account parameter; hook default deny, sanctions, caps, payee list; T2 for anything unusual; red-team suite |
| Compromised backend (api, scheduler, bundler) | Withhold, delay, spam, show the user wrong details | Signatures verified on-chain; clients decode calldata and recompute the digest themselves; member services verify staff passkeys themselves; paymaster rate limits; heartbeat fail-safe |
| Compromised mcp (the only caller allowed to ask the agent signer to sign) | Act inside the T1 mandate, like a leaked agent key | Hook bounds, signer rate limit, owner revoke, consortium freeze |
| Compromised WeCross router / relayer | Drop or delay consortium messages | Member signatures, nonces, deadlines; silence ⇒ RESTRICTED; watchdog delivery path |
| Leaked agent key / compromised agent TEE | Act inside the mandate | Bounded by hook + bank caps; owner revokes alone; consortium freezes; rate limit in signer |
| Compromised attester key | Sign SOTER approvals for **every** SOTER-enabled account (bindings and counters are public), T2 payments up to each hard cap | Bank caps (T0) still apply; approvals expire within 1 h; any one member deactivates the attester; users can turn SOTER off in their policy |
| False Tencent `is_ok` alone | Nothing without a SOTER signature from the bound phone over the exact digest | Attester checks raw == digest and the binding |
| Stolen phone | Approve as the user | Phone biometrics; owner can unlink from the web app; bank can freeze |
| Malicious member key (one) | Freeze or restrict (annoying, safe direction); delist; list sanctions | Loosening needs 2; audit trail shows who signed |
| Replay of old messages / approvals | Re-apply old status or approval | Nonces, deadlines, single-use approvals, counters |
| Oracle feeder compromise | Push wrong prices (bounded per update) | Max deviation per update, staleness, slippage bound, band T0 bank limits, demo flag |
| Web attacker | XSS/CSRF/session theft, OAuth abuse on MCP | CSP, httpOnly cookies, CSRF tokens, PKCE, redirect URI allowlist, origin checks on WS |
| Insider reading logs | Learn PII | PII redaction, KYC data only in bank-service encrypted, no identifiers in logs |

## Permission tiers (copy into the self-assessment)

The T0–T4 table in [00-decisions.md](00-decisions.md), plus for each tier: example action, verifying contract function, signer(s), and the test file that proves it.

## Red-team suite (`test/redteam`)

Runs against the full local stack with the real model (live suite) and with scripted tool calls (CI). Each case: input, expected outcome, observed outcome, tx hashes. Reported as **"N attacks, 0 executed"**. 20% of cases are **held out**: written by a teammate, kept outside the repo, run in Phase C.

Minimum set (≥ 40 cases):
1. Prompt injections in chat, in a merchant invoice memo, in a payee name, in a tool result (10 variants) asking to pay a new/sanctioned address, raise caps, approve itself, change the payee list.
2. Over hard cap; split payments to dodge the auto cap; budget exhaustion; count exhaustion.
3. Swap into an unapproved token; into a DELISTED token; swap with bad `minOut`; swap during stale price; two rebalances in a day.
4. delegatecall batch; ETH value; self-call to `installModule`/`uninstallModule`; try-mode execute; non-canonical batch encoding; unknown selector on USDC (`approve` to an EOA, `transferFrom`, `permit`); **USDC `permit` / `transferWithAuthorization` (EIP-3009) using an ERC-1271 account signature** (agent key, passkey, empty).
5. Safe `execTransaction` by anyone; userOp with nonce key 0 (owner fallback); agent key sending `installModule` calldata.
6. Forged StatusAttestation (non-member), 1-signature loosen, replayed old nonce, nonce jump to 2⁶⁴−1 by one member, expired deadline, duplicated signer, malleable signature, signature from another environment's domain (`Praetor-local` on live).
7. Replay a Tier2Approval; approval for a different callHash; expired approval; SOTER replay (same counter); SOTER from another binding; attester not active; SOTER for SET_OWNER_KEY.
8. Payout to a suspended partner; payout for a CN-jurisdiction user; standing order triggered twice; amount > max.
9. Actions while FROZEN (payment, swap, payout, standing order, registerApproval then execute); heartbeat stale ⇒ autonomous refused.
10. MCP: token for account A used to act on account B; OAuth redirect manipulation; tool output contains PII (must not).
11. Web: CSRF on owner actions; XSS payload in payee label rendered in UI; WS from foreign origin.

## Static analysis and tests

- **Slither** on `contracts/base` and `contracts/fisco` (config in `slither.config.json`, excludes vendored libs). Report `docs/security/slither.md`: every finding fixed or justified. Also `forge lint`.
- **Foundry**: unit, fuzz (≥ 10k runs in CI profile), invariants (I8, I14, I15, spent accounting), fork tests on Safe7579. Coverage report (`forge coverage`), target ≥ 90% lines on MandateHook.
- **Services**: vitest unit + integration; Playwright e2e.
- **Dependency audit**: `pnpm audit --prod`, OWASP dependency-check for the Java parts, `gitleaks` on the repo history; all lockfiles committed, exact versions pinned.
- **Pentest** (Phase C, with the team's AI pentest pipeline + manual): web app, api, mcp/OAuth, mini program backend, WeChat callback, console. Report `docs/security/pentest.md` with findings and fixes.
- **TEE deployment checklist** applied to both CVMs (`docs/security/tee-checklist.md`): production (non-debug) CVM, image digests pinned, compose hash registered by the bank, re-registered on every change, secrets only as encrypted env, TLS inside the CVM, no key export route, simulator refused in prod config.

## Known risks (start of the list for the self-assessment)

1. A compromised agent TEE or leaked agent key can act inside the mandate until revoked or frozen.
2. SOTER approvals trust Tencent's unsigned `is_ok` and our attester code; bounded by binding, counter, hard cap and bank caps.
3. The demo consortium is run by one team; in production the three members are independent organisations with their own HSMs.
4. tXAU/tXAG are unbacked demo tokens; in production the issuer is a regulated custodian with proof of reserves.
5. Payout partner and gateways are mocks; production needs a licensed PSP and merchant agreements; stablecoin payouts only where licensed, never for mainland-China residents.
6. Oracle feeder is a single key (bounded); production would read Pyth on-chain with update fees or use multiple feeders.
7. RefusalLog's link to the userOpHash is reporter-claimed (the reason is not).
8. WeCross v1.4.0 is unmaintained upstream; our EVM stub is new code.
9. A consortium freeze also blocks the owner's own payments (regulated account by design).
10. Mini program runs on a test account; publication needs a registered company and ICP filing.
11. Fixed 30-day epochs instead of calendar months (up to two monthly budgets across a boundary).
12. The bank's ERC-3643 agent key can force-transfer or burn tXAU/tXAG of any holder (the standard's recovery power), outside the hook.
13. A compromised mcp can act inside the T1 mandate (it is the only caller of the agent signer).
14. A compromised attester key can approve T2 payments for every SOTER-enabled account until deactivated.
15. In the demo the operator runs 2 of the 4 FISCO sealers and can halt the consortium chain.
16. SOTER's counter may not increase on iOS; if Phase C shows that, the counter is recorded but not enforced (replay is still impossible: each approval's digest is single-use).
17. WeIdentity REST is custodial and unauthenticated; isolated on the internal network.
