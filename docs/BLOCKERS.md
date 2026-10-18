# Blockers

Each entry: what, why, what was tried, fallback taken, status. Phase B never stops on a blocker: it takes the fallback and moves to the next milestone that does not depend on it.

## B1. No funded Base Sepolia address (live run)

- **What**: M16 (live run on Base Sepolia, evidence with real tx hashes) and the live half of M18 need the LIVE set funded (QUESTIONS.md, Funding).
- **Why**: at go (2026-10-17 07:02 UTC) every LIVE and SANDBOX address had 0 ETH.
- **Tried**: balance read on `https://sepolia.base.org`.
- **Fallback**: everything runs on the anvil fork (same chain id, domain `Praetor-local`). Live scripts are built and tested against the fork; M16 is re-checked when balances appear.
- **Update 2026-10-17/18**: the human funded the deployer (0.0133 ETH) and the treasury (44 USDC). Within that budget (D74): the ETH was spread to the gas accounts (`scripts/deploy/fund-live.ts`) and Praetor was deployed once on Base Sepolia (`infra/deployments/base-sepolia.json`, MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, about 0.0045 ETH), with its consortium on the local FISCO chain (D75). The SANDBOX set is still unfunded: the sandbox stays interim (D48).
- **Update 2026-10-18**: M18 closed with a rehearsal on the fork (D90); its live half (live Base, Phala TEEs, a real certificate) is Phase C.
- **Update 2026-10-18**: M16 closed: the evidence run went on Base Sepolia within this budget (D74, D96), its transactions in `docs/EVIDENCE.md`.
- **Status**: resolved (live funded, M16 done; D74, D96). The SANDBOX set is still unfunded: the own sandbox deployment is not built (Phase C).

## B2. No human `.env` values (Pyth, WeChat, OA)

- **What**: `PYTH_API_KEY`, `MP_*`, `OA_*` empty.
- **Fallback**: seeded DEMO prices (Q27); SOTER fixture behind `SOTER_FAKE_TENCENT=1`; OA notifications to the log sink and web push; MANUAL steps for Phase C.
- **Update 2026-10-18**: the human gave `PYTH_API_KEY` (D89). The oracle-feeder reads real XAU and XAG prices from Pyth Hermes on live Base Sepolia only, one request for both feeds every 5 minutes; the fork keeps the seeded DEMO prices its tests set (the real prices are far above the seeded ones and PriceOracle refuses a move over 25 %). The team's iPhone test of the mini program used a WeChat mini program test account (MANUAL 5). `OA_*` are still empty: Official Account notifications go to the log sink and web push.
- **Status**: price half resolved for live (D89); WeChat Official Account half open (not blocking).

## B3. Guomi profile: the agent's secp256k1 key cannot update its WeID on an SM chain

- **What**: in the M15 SM smoke, Alex's 43-step WeIdentity scenario gives 39 PASS, 4 FAIL, 1 INFO (the known revocation INFO). The 4 failures are the agent's own DID document updates signed with its secp256k1 key: e3 `setService` (AgentWallet, MCP), e4 `setAuthentication` (user as controller), and the two read-backs that expect those entries (e5, e5-rest), all with "the private key does not match the current weid".
- **Why**: the agent key is secp256k1 by design (it signs userOps on Base, from the TEE). On an SM chain the WeIdentity SDK treats every private key as SM2 and derives WeID addresses with SM3, so the agent WeID created from the secp256k1 public key (e2, which passes) is never owned by that key.
- **Tried**: the scenario unchanged against the SM deployment (Build-Tools e80d870 with `sm_crypto=1`, REST 1.7.0); deployment, `createWeId`, CPTs, issuer registration, credentials, multi-signatures, selective disclosure, evidence and revocation all pass in SM mode.
- **Fallback**: Guomi profile only (the main profile is unaffected and runs 43 PASS). In SM mode the agent's DID document would be kept with an SM2 key (custodial on the bank side, like the users' WeIDs), and the agent's secp256k1 key stays what Base checks: the AgentMandate credential and the KYA attestation carry it as a claim. Not built: the Guomi profile is a smoke (spec 04).
- **Status**: open, recorded in `docs/SMOKE.md` (Guomi profile).
