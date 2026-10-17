# Phase C manual (guided acceptance with the human)

For the human, with Claude walking through one step at a time, riskiest first (spec 10, Phase C). Each step: **You do** / **You see** / **Claude checks** / **Fallback**.

If you are Claude starting a Phase C session: read `CLAUDE.md`, `docs/PROGRESS.md` and this file, run `make test`, then take the human through from step 1, one step per message. A bug found on a phone first becomes a failing test, then gets fixed.

Steps are added during Phase B, each time something needs a human (phone Face ID, WeChat DevTools QR login, EUDI wallet scan, Official Account messages, cloud deployment).

## 0. Before Phase B (from Phase 0)

| | |
|---|---|
| **You do** | Answer `docs/QUESTIONS.md` (or accept the defaults), fill the empty human values in `.env` (`MP_*`, `OA_*`, `PYTH_API_KEY`, `OPENCODE_API_KEY` if needed), fund the addresses listed in QUESTIONS.md section "Funding", then say "go". |
| **You see** | Balances on https://sepolia.basescan.org for each funded address. |
| **Claude checks** | `.env` values present (never printed), balances read on Base Sepolia, then starts Phase B. |
| **Fallback** | Unfunded live addresses: Phase B runs everything on the fork; M16 (live run) waits in BLOCKERS.md. |
