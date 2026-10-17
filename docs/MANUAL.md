# Phase C manual (guided acceptance with the human)

For the human, with Claude walking through one step at a time, riskiest first (spec 10, Phase C). Each step: **You do** / **You see** / **Claude checks** / **Fallback**.

If you are Claude starting a Phase C session: read `CLAUDE.md`, `docs/PROGRESS.md` and this file, run `make test`, then take the human through from step 1, one step per message. A bug found on a phone first becomes a failing test, then gets fixed.

Steps are added during Phase B, each time something needs a human (phone Face ID, WeChat DevTools QR login, EUDI wallet scan, Official Account messages, cloud deployment).

## 0. Before Phase B (from Phase 0)

| | |
|---|---|
| **You do** | Keep the laptop awake on AC power: leave `systemd-inhibit --what=sleep:idle:handle-lid-switch --who=praetor --why="Phase B build" --mode=block sleep infinity` running in a terminal (or set KDE power management to never suspend). Answer `docs/QUESTIONS.md` (or accept the defaults), fill the empty human values in `.env` (`MP_*`, `OA_*`, `PYTH_API_KEY`, `OPENCODE_API_KEY` if needed), fund the addresses listed in QUESTIONS.md section "Funding", then say "go". |
| **You see** | Balances on https://sepolia.basescan.org for each funded address. |
| **Claude checks** | `.env` values present (never printed), balances read on Base Sepolia, then starts Phase B. |
| **Fallback** | Unfunded live addresses: Phase B runs everything on the fork; M16 (live run) waits in BLOCKERS.md. |

## 1. KYC with a real EU Digital Identity Wallet (M6)

| | |
|---|---|
| **You do** | Install a wallet holding a test PID (EUDI reference wallet with the test issuer, or Procivis One trial). In the web app (or with `curl` against bank-service through Claude), start KYC with the method "EU Digital Identity Wallet" and scan the QR code with the wallet; approve sharing the birthdate and nationality / issuing country. |
| **You see** | The wallet asks for only the birthdate and the country fields. The Praetor page moves to "verified", then to suitability. |
| **Claude checks** | `GET /kyc/sessions/:id` on bank-service turns `verified` with `kycLevel: 1` and the right jurisdiction; `docker compose logs bank` contains no birthdate; after suitability, PersonKYC evidence exists on FISCO (`weid-client getEvidence`). Automated stand-in: `services/bank/test/eudiw.test.ts` (SD-JWT fixtures) and the vendor-path integration test. |
| **Fallback** | The public verifier backend (`EUDI_VERIFIER_BACKEND`) is down or refuses the test issuer: use the Demo KYC provider path (same PersonKYC, `kycLevel: 2`) and show the EUDI request built by `buildPresentationRequest` in the unit test. |

## 2. Real TEE attestations on Phala Cloud (M7, with the deployment in step M18)

| | |
|---|---|
| **You do** | Once agent-signer and soter-attester run in Phala CVMs (deployment rehearsal), give Claude their compose hashes from the Phala dashboard. |
| **You see** | Each CVM's dashboard shows the app id and compose hash; the services' `/v1/info` say `simulator: false`. |
| **Claude checks** | Puts the hashes in `ALLOWED_COMPOSE_HASHES_AGENT` / `_ATTESTER` (Phala encrypted env), sets `ATTESTATION_MODE=phala`, runs one KYA and one attester activation: bank-service verifies both quotes through `https://cloud-api.phala.com/api/v1/attestations/verify` and refuses a quote whose compose hash is not listed. Automated stand-in: the simulator path (`test/integration/agent-signer.test.ts`, `bank-kya.test.ts`, `soter-attester.test.ts`) and the Phala path with a scripted verifier (`services/bank/test/attestation.test.ts`). |
| **Fallback** | The verify API is unreachable or its response shape differs: keep the CVMs, show the quotes and compose hashes, and say plainly that the bank's prod verification was exercised only against a scripted verifier. |

## 3. The agent with the real model, and claude.ai as an external agent (M8)

| | |
|---|---|
| **You do** | (a) In the web app chat (M13) or through Claude with `scripts/demo/lib.ts agentChat`, ask Lin's agent "Pay the café 12.50", then "What is my portfolio?", in English and in 中文. (b) In claude.ai, add a custom connector with the URL `https://<public host>/mcp`, sign in to Praetor when asked and allow access. |
| **You see** | (a) The real DeepSeek model calls `praetor_pay`, the payment lands, the answer quotes the transaction; in 中文 the answer is in Chinese. (b) claude.ai lists the Praetor tools and `get_portfolio` answers with Lin's numbers. |
| **Claude checks** | The agent-runner transcript shows only `praetor_*` tools ran (any built-in tool call was rejected); mcp logged an OAuth bearer for (b) and the agent bearer for (a); the tx is on the explorer. Automated stand-in: F4/F5 with the scripted model, `services/mcp/test/oauth.test.ts` (28 OAuth cases, the claude.ai registration body). |
| **Fallback** | The free model refuses or is down: set `OPENCODE_API_KEY` (paid DeepSeek) or show the scripted run; claude.ai cannot reach the tunnel: use the MCP inspector against the same URL. |
