# Blockers

Each entry: what, why, what was tried, fallback taken, status. Phase B never stops on a blocker: it takes the fallback and moves to the next milestone that does not depend on it.

## B1. No funded Base Sepolia address (live run)

- **What**: M16 (live run on Base Sepolia, evidence with real tx hashes) and the live half of M18 need the LIVE set funded (QUESTIONS.md, Funding).
- **Why**: at go (2026-10-17 07:02 UTC) every LIVE and SANDBOX address had 0 ETH.
- **Tried**: balance read on `https://sepolia.base.org`.
- **Fallback**: everything runs on the anvil fork (same chain id, domain `Praetor-local`). Live scripts are built and tested against the fork; M16 is re-checked when balances appear.
- **Status**: open.

## B2. No human `.env` values (Pyth, WeChat, OA)

- **What**: `PYTH_API_KEY`, `MP_*`, `OA_*` empty.
- **Fallback**: seeded DEMO prices (Q27); SOTER fixture behind `SOTER_FAKE_TENCENT=1`; OA notifications to the log sink and web push; MANUAL steps for Phase C.
- **Status**: open (not blocking Phase B).
