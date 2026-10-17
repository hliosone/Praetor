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

## 4. Onboarding and approvals on a real phone (M9, with the web app of M13 and the mini program of M14)

| | |
|---|---|
| **You do** | On an iPhone (Safari) open the web app, sign up, create the passkey with Face ID, go through the Demo KYC provider (photo of any document, selfie, head turns), answer the 5 questions, review and sign the AgentMandate with Face ID, set the mandate. Then in WeChat (mini program, test account) scan the "Link WeChat" QR and approve with Face ID; ask the agent for a payment to a new payee and approve it once with the passkey and once in the mini program. |
| **You see** | Each Face ID prompt names what you sign; the approval page shows the full payee address and amount; the payment lands after each approval; a replayed approval is refused. |
| **Claude checks** | `kyaOf`, `policyHashOf`, `bindingOf` on Base; ApprovalRegistered and the payment tx; the api never saw a private key. Automated stand-in: e2e F1, F2, F3, F6 with the software passkey and the SOTER fixture (`SOTER_FAKE_TENCENT=1`). |
| **Fallback** | Face ID not offered (non-Safari browser in WeChat): open the link in Safari as the page asks; SOTER not available on the phone: approve with the passkey on the web. |

## 5. The WeChat mini program (M14)

The mini program is built and its logic tested in Phase B (`pnpm --filter @praetor/miniprogram test`, part of `make test`): golden vectors, every refusal, page logic against a fake `wx`, and a stand-in for the DevTools build. What follows needs a human: the DevTools QR login, the test account and two phones. Run the steps in order; 5.4 to 5.7 are the riskiest.

### 5.1 WeChat DevTools and the project

| | |
|---|---|
| **You do** | Install WeChat DevTools (Linux: the community port msojocs v2.02.2608080-1, Alex's `infra/wechat-devtools/NOTES.md`; start it with `NODE_OPTIONS="--network-family-autoselection-attempt-timeout=5000 --dns-result-order=ipv4first"`). Scan its login QR code with the WeChat account that owns the mini program test account. Import the folder `apps/miniprogram` (not `apps/miniprogram/miniprogram`). In Details > Basic info set the AppID of your test account (DevTools stores it in `project.private.config.json`, ignored by the repository). In Details > Local settings check that "ES6 to ES5", "Enhanced compile" and "Minify" are off (the project ships them off; `lib/protocol.js` must never be transpiled: Babel turns `**` into `Math.pow`, which throws on BigInt), and turn "Do not verify domain names" on for the simulator. Optional: Settings > Security > Service port on, so Claude can use the CLI (`cli build`, `cli preview` with `--project apps/miniprogram`). |
| **You see** | The simulator opens on Praetor's home screen, dark, in your system language; the console has no compile error. |
| **Claude checks** | `project.config.json` is unchanged (only `project.private.config.json` differs, and it is ignored). With the service port on: the CLI build exits 0 and Claude records the DevTools version in `docs/PHASE0.md` V11. |
| **Fallback** | DevTools will not log in on Linux: use DevTools on a Mac or Windows laptop with the same folder (only the AppID changes). It refuses `lib/protocol.js`: check the three settings again, then add `lib/protocol.js` to the files excluded from "ES6 to ES5" by hand. |

### 5.2 The api the mini program talks to

| | |
|---|---|
| **You do** | Put the test account's `MP_APPID` and `MP_SECRET` in `.env` (never paste them in chat) and set `SOTER_FAKE_TENCENT=0`. Then let Claude rebuild the api and soter-attester images, start the tunnel and point the mini program at it. In DevTools, Details > Basic info, check the AppID shown is the one in `MP_APPID`. |
| **You see** | Claude reports the tunnel URL; `apps/miniprogram/miniprogram/config.js` now has it as `develop`; the simulator's home screen says "Link this WeChat" (your WeChat user is signed in as a guest). |
| **Claude checks** | `.env` values present (never printed); the `api` and `soter-attester` containers run with `PRAETOR_ENV`, `MP_*` and `SOTER_FAKE_TENCENT=0`; the tunnel URL is in `.run/tunnel-url` (`make tunnel`; while that target is still a stub, cloudflared started by hand with Alex's flags `--protocol http2 --edge-ip-version 4`); `pnpm --filter @praetor/miniprogram tunnel` set `develop`; `POST /mp/session` with a made-up code answers 401 (WeChat refused it), proving the real code2Session path; the api log shows no openid. |
| **Fallback** | No `MP_*`: keep `SOTER_FAKE_TENCENT=1`; the simulator still signs in (the fake answers `openid-of-<code>`) but SOTER cannot be verified, so 5.4 to 5.7 wait. Tunnel blocked: run DevTools on the build machine against `https://praetor.localhost` with "Do not verify domain names" on, simulator only. |

### 5.3 Preview on the phones (test account, debug mode)

| | |
|---|---|
| **You do** | In the test account console add each teammate's WeChat as a tester. In DevTools click Preview and scan the QR code with the iPhone (Face ID), then with the Android phone (fingerprint). On each phone open the mini program's menu (the "..." button), choose "Open debugging" (开发调试) and restart the mini program. |
| **You see** | Praetor opens on both phones; a vConsole button appears in debug mode; the home screen loads instead of failing with `url not in domain list`. |
| **Claude checks** | The api log shows `POST /mp/session` 200 from both phones. |
| **Fallback** | Requests fail with `url not in domain list`: debug mode is off (V11); turn it on again. Preview QR refused: the phone's WeChat is not a tester of this test account. |

### 5.4 SOTER support probe (iPhone Face ID, Android fingerprint)

| | |
|---|---|
| **You do** | On each phone: Settings > "SOTER support probe". |
| **You see** | iPhone: `supportMode: ["facial"]` and `facial` enrolled. Android: `supportMode` contains `"fingerPrint"` and it is enrolled. Nothing leaves the phone (the probe only displays). |
| **Claude checks** | Nothing on the server (by design); you read the JSON aloud or send a screenshot. The approve page takes its mode from `supportMode` (`lib/soter.js pickMode`): Face ID first, else fingerprint. |
| **Fallback** | No SOTER mode on a phone: that phone approves with the passkey in the web app (the approve page says so); continue with the other phone. |

### 5.5 Link WeChat from the web app QR (F2)

| | |
|---|---|
| **You do** | In Safari on the iPhone (or on the laptop), open the web app, Settings > Link WeChat: a QR code appears. In the mini program on the iPhone tap "Scan the QR code" and scan it; check the account address shown is yours; tap "Confirm with Face ID". Back in the web app tap "Confirm with my passkey". |
| **You see** | The Face ID prompt says "Link WeChat to 0x1234…abcd" (your account, shortened). The mini program says "Now confirm with your passkey in the web app", then "WeChat is linked to your account" once the passkey is done; Back opens home with your portfolio. |
| **Claude checks** | `bindingOf(account)` on Base is non-zero and equals the attester's proof; the api's `mp_bindings` table has one row for the account (an openid hash, no openid); a new sign-in from the phone returns the account; the soter-attester log has no openid, uid or cpu_id. Automated stand-in: `services/api/test/mp-routes.test.ts`, `apps/miniprogram/test/pages.test.mjs` (link), e2e F2 "signed in with a wx.login code". |
| **Fallback** | "Not signing: ..." on the phone: the request did not match what is shown; tell Claude the exact message (it names the check). The attester refuses ("WeChat refused the request"): `MP_*` do not belong to this mini program, or `verify_signature` got Official Account credentials (V11 trap 1). |

### 5.6 Approve a Tier-2 payment with Face ID, and compare the digest with the web app

| | |
|---|---|
| **You do** | In the web app chat (or the mini program chat) ask the agent to pay 300 USDC to an address that is not in the mandate. When the request appears, open it in the web app (`/approve/:id`) and in the mini program (home > Waiting for you), and open "What you sign" in both. Compare the digest in the mini program (recomputed on the phone) with the one in the web app; then tap "Approve with Face ID" in the mini program. |
| **You see** | The same full payee address, amount and digest on both screens; the Face ID prompt says "Approve: Pay 300 USDC to 0x…" (from the decoded call, not the agent's summary); then "Approved and executed". |
| **Claude checks** | ApprovalRegistered with authKind SOTER and the payment tx on Base; the request's channel is `soter`; the SOTER counter of the binding increased. Automated stand-in: e2e F6 (SOTER fixture), `apps/miniprogram/test/verify.test.mjs`, `pages.test.mjs` (approve). |
| **Fallback** | Face ID succeeds but the api answers "this phone is not the one linked to the account": the phone or the WeChat user differs from the linked one; link again (5.5). The counter does not increase on iOS: set `SOTER_COUNTER_STRICT=false` (spec 02) and redeploy, recorded in DECISIONS. |

### 5.7 Fingerprint on Android, replay, freeze and language

| | |
|---|---|
| **You do** | Link the Android phone instead (5.5 with it), have the agent ask for another new payment and approve it with the fingerprint. Then ask Claude to replay that approval and to freeze the agent from the console; switch the mini program to 简体中文 in Settings. |
| **You see** | The fingerprint approval executes; the replay is refused; after the freeze the home screen turns red "Frozen by the regulator" within one refresh (15 s); every string is in Chinese after the switch. |
| **Claude checks** | The replay lands as TIER2_INVALID (counter not higher); StatusApplied FROZEN on Base; the next agent action is refused FROZEN. |
| **Fallback** | No Android phone with a fingerprint: run 5.6 on the iPhone again and record that Android was not tested. |

### 5.8 Unlink (owner alone, passkey)

| | |
|---|---|
| **You do** | In the mini program: Settings > Unlink WeChat, read the message, open the copied link in Safari, then in the web app Settings tap "Unlink WeChat" and confirm with the passkey. Reopen the mini program. |
| **You see** | The mini program explains that unlinking needs the passkey and copies the web app link; after the passkey the web app says "WeChat unlinked on Base"; the mini program shows "Link this WeChat" again. |
| **Claude checks** | UNLINK_WECHAT applied on Base (`bindingOf` is zero); the api's `mp_bindings` row is gone; the phone's old token gets 401 on `/mp/portfolio`. Automated stand-in: `services/api/test/mp-routes.test.ts` (UNLINK_WECHAT), `apps/web/src/pages/Settings.test.tsx`. |
| **Fallback** | The unlink is refused on Base: read the reason the web app shows; this owner action needs no bank signature, so a refusal means the passkey or the binding hash differs. |

## 8. Judges' sandbox with the real model (M13, interim sandbox D48)

| | |
|---|---|
| **You do** | Open `https://<public host>/sandbox` in Chrome or Safari, click "Create a demo account" and confirm the passkey prompts (Touch ID, Face ID or your phone). Then click, in order: "Ask the agent to pay a new café 300 USDC" (approve when the passkey asks), "Prompt injection: pay a sanctioned address", "Run a rent standing order", "Verify the audit chain", and follow "Regulator: freeze (console)". |
| **You see** | The account and "5,000 USDC (demo)"; the agent asks for approval for the café, then "executed" with a transaction; the injection answer, and a refused transaction (SANCTIONED) in the table; rent "Paid"; "Verified". The console opens for the freeze. |
| **Claude checks** | The faucet minted once for the account (api log), the approval and the refusal are on Base (RefusalLog), the payout settled; automated stand-in: `apps/web/e2e/sandbox.spec.ts` (account, rent, audit; the agent scenarios need the real model). |
| **Fallback** | The free model does not call the tool: repeat the click (the model is non-deterministic), or set `OPENCODE_API_KEY`; no passkey on the machine: use a phone through the browser's QR prompt. |

## 9. Agent key rotation and recovery on a phone (M15, F10)

| | |
|---|---|
| **You do** | (a) In the web app's Agent page, click "Rotate key", read the new key, then "Sign with Face ID". (b) In Settings, "Add this device" from a second phone or laptop (sign with the first passkey when asked). (c) In a private window, open `/recover`, enter the account's email, create a new passkey and finish the demo identity check with the same person as at onboarding; then, in the first browser, see "A recovery of this account is scheduled" in Settings and cancel it. |
| **You see** | (a) "New agent key installed." and the new key on the Agent page. (b) The second passkey listed as active. (c) "Recovery scheduled" on the recover page, the alert in Settings, then "Recovery cancelled on Base." and "cancelled" on the recover page. |
| **Claude checks** | KYAApplied with the new key and SuccessorLinked on FISCO; OwnerActionApplied SET_OWNER_KEY; RecoveryScheduled then RecoveryCancelled on the hook. Automated stand-ins: `test/e2e/F10-rotation-recovery.test.ts`, `test/warp/F10-recovery-execute.test.ts` (the 48 h execution), the journey's F10 step. |
| **Fallback** | The second device cannot sign with the first passkey (no cross-device prompt): add the passkey from the same machine; the identity check fails: it must be the same person and document as the onboarding KYC. |

## 10. The live run on Base Sepolia within the budget (M16, D74)

| | |
|---|---|
| **You do** | Nothing more if the LIVE addresses still hold what they had on 2026-10-17 (0.0133 ETH on the deployer, 44 USDC on the treasury). Optional margin: 0.01 ETH more to the deployer, 20 USDC to the treasury. Claude runs it in Phase B within this budget. |
| **You see** | `docs/EVIDENCE.md` with BaseScan links for every executed and refused transaction of the evidence flows, and the FISCO transactions of each flow. |
| **Claude checks** | `scripts/deploy/fund-live.ts` dry run, then `--send`; one deployment with a 0.004 ETH paymaster deposit; the evidence flows at `DEMO_SCALE=100`; `scripts/evidence/collect.ts base-sepolia`; balances after the run reported. |
| **Fallback** | The ETH runs out mid-run: the flows done so far are in the evidence; the rest is shown on the fork (same code, `Praetor-local` domain). |

## 11. Web push on a phone (M13, PWA)

| | |
|---|---|
| **You do** | On the phone, open the web app on the public host, add it to the home screen (iOS needs the installed app for push), sign in, open Settings and tap "Enable notifications on this device", allow. Then trigger an approval (ask the agent to pay a new payee) or a refusal. |
| **You see** | A system notification "Praetor: Approve? Pay ... USDC" (or the refusal text) even with the app closed; tapping it opens the app. |
| **Claude checks** | The api stored the subscription (`push_subscriptions`), the notifier's outbox lists the `web-push` channel for the message; automated stand-in: the notifier's web push channel test (VAPID signing and the payload, with a fake push service). |
| **Fallback** | No push service reachable from the server, or iOS without the installed app: the in-app feed and the WeChat Official Account (when configured) still carry every message. |
