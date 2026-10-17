# Pre-existing code disclosure

Everything in this repository was written for FinTechathon 2026 starting 2026-10-17, except what is listed here. Reuse means: the source was read, what fits was copied into the new layout with its attribution, and it is covered by tests in this repo. The reference repos are never imported as dependencies.

Sources:
- **Alex's walking skeleton** (`ahuou/Praetor`, local copy `../ressources_code/Praetor`, commits `408e594`, `3b8eeff`, written 2026-10-16/17 by a team member): proven connection code and documented traps.
- **BSA Sentry** (`hliosone/bsa-sentry`, local copy `../ressources_code/bsa-sentry`, written 2026-10-07 to 2026-10-13 by the same team for LedgerOpen 2026), reused with its authors' agreement.

| File in this repo | Source | What was taken | Date taken |
|---|---|---|---|
| `scripts/keys/generate.ts`, `scripts/keys/lib.ts` | BSA Sentry `scripts/gen-keys.ts` | The approach only (generate into `.env` mode 600, print public addresses, never secrets); rewritten to be append-only and to cover three key sets | 2026-10-17 |
| `scripts/git-hooks/commit-msg` | none (new) | | |
| `spikes/V3-weid/scenario/` (Phase 0 spike only) | Alex's `services/identity/scenario.sh` and `services/identity/java/` | Copied unchanged to re-run his 43-step WeIdentity scenario against our Dockerised chain; M6 ports it into `services/identity` under tests | 2026-10-17 |
| `spikes/V1-safe7579/` (Phase 0 spike only) | Alex's `services/relayer/base.mjs`, `checks/safe7579-first-userop.mjs`, `contracts/src/base/BlockTargetHook.sol` | Read as the starting point (addresses, launchpad encoding, hook decoding); the spike code is new Solidity | 2026-10-17 |

Third-party sources kept in the spikes (not team code; recorded in `NOTICE` at M0): `spikes/V4-wecross/evm-proxy/WeCrossProxy.bcos3.orig.sol.txt` and the patched `WeCrossProxyEVM.sol` (WeCross, Apache-2.0), `spikes/V9-webase/webase-front-v3.1.1-no-scaffold.patch` (a diff against WeBASE-Front, Apache-2.0).
