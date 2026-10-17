# 09 · Repo layout and reuse

## New repo (`praetor`, private, all rights reserved)

```
praetor/
├── CLAUDE.md                       run mode + rules (written from 10-build-plan.md)
├── README.md / README.zh-CN.md
├── spec/                           this specification (frozen input; changes logged in docs/DECISIONS.md)
├── docs/
│   ├── PROGRESS.md  DECISIONS.md  BLOCKERS.md  QUESTIONS.md  MANUAL.md (Phase C guide)  PREEXISTING.md
│   ├── EVIDENCE.md                 every tx hash (Base Sepolia + FISCO), executed and refused, per flow
│   ├── ARCHITECTURE.md (+ zh-CN)   technical documentation deliverable
│   ├── security/                   self-assessment, slither.md, redteam.md, pentest.md, tee-checklist.md, deps.md
│   ├── zh-CN/                      Chinese versions of the deliverable docs
│   └── screens/                    web/ and miniprogram/ screenshots per milestone
├── packages/
│   ├── protocol/                   TS + Solidity twin + vectors (02)
│   ├── chain/  userop/  db/  api-schema/  weid-client/  ui-tokens/  fisco-client/
├── contracts/
│   ├── base/                       Foundry (cancun): src/, test/ (unit, fuzz, invariant, fork), script/Deploy.s.sol
│   └── fisco/                      Foundry (paris): src/, test/, script/
├── services/
│   ├── api/  bundler/  mcp/  agent/ (agent-runner + opencode config)  scheduler/  oracle-feeder/
│   ├── bank/  regulator/  operator/  bridge-relayer/  notifier/
│   ├── payout-partner/  alipayplus-mock/  wechatpay-mock/  kyc-vendor-mock/
│   └── identity/ (weid-rest config, weid-helper Java)
├── tee/
│   ├── agent-signer/               Dockerfile + compose for Phala (app-compose), src/
│   └── soter-attester/
├── wecross/
│   ├── router/                     config (chains/fisco, chains/base), Dockerfile (JDK 8)
│   └── evm-stub/                   Java 8 Gradle project (our EVM stub)
├── apps/
│   ├── web/                        React + Vite + R3F, PWA, console, sandbox
│   └── miniprogram/                WeChat mini program
├── infra/
│   ├── compose.yml                 everything (profiles: core, wecross, tee-sim, mocks, explorer, dev)
│   ├── compose.prod.yml            prod overrides (Caddy TLS, restart policies, no anvil, live Base)
│   ├── Caddyfile  .env.example  deployments/{fork,base-sepolia}.json
│   ├── fisco/ (build_chain wrapper, node configs, both profiles)  weid/  webase/  seed/
│   └── wechat-devtools/  tunnels/
├── test/
│   ├── e2e/                        F1–F10 (06), runs against BASE_URL
│   ├── integration/                one file per link (FISCO→WeCross→Base, api→attester, mcp→signer→bundler…)
│   └── redteam/ (+ heldout/)
├── scripts/                        keys/generate.ts, demo/shock.ts, demo/seed.ts, evidence/collect.ts, deploy/*.sh
├── Makefile                        up, down, test, test-int, e2e, e2e-live, redteam, slither, deploy-contracts, deploy
└── THIRD_PARTY_LICENSES.md  NOTICE
```

## Reuse map

Reuse means: read the source, copy what fits **into the new layout**, keep attribution, add it to `docs/PREEXISTING.md`, then cover it with tests in the new repo. Never import the reference repos as dependencies.

### From Alex's skeleton (`ahuou/Praetor`)

| Source | Reuse for | Notes |
|---|---|---|
| `services/relayer/base.mjs` (`sendUserOp`, `explainRefusal`, `waitSynced`, `fundOnFork`, Safe7579 addresses) | `packages/userop`, `services/bundler`, `packages/chain` | Proven self-bundling + receipt-block reads. Replace `explainRefusal` with `checkBatch`. |
| `services/relayer/fisco.mjs` (`getEventsChunked`, `pollEvent`) | `packages/fisco-client` | getLogs ≤ 10-block rule |
| `checks/safe7579-first-userop.mjs`, `checks/safe7579-address.mjs`, `checks/base-safe7579-empty-attesters-gs000.LIVE.mjs` | `packages/userop` account creation + fork tests | GS000 fix, launchpad init data |
| `checks/guard-hook-allow-block-refusal-log.mjs`, `contracts/src/base/BlockTargetHook.sol` | MandateHook execute decoding, fork test harness | |
| `checks/base-recovers-fisco-sig-and-p256.cjs`, `checks/relay-fisco-event-to-base.LIVE.cjs` | bridge-relayer, protocol tests | |
| `checks/webauthn-sol-verify.mjs`, `services/approvals/passkey/passkey.js` (`derToRS`, low-s normalisation, verify both ways) | PasskeyValidator tests, api passkey routes | Challenge constant "Allow: …" is legacy: don't reuse it |
| `services/approvals/passkey/pwa.js`, `make-icon.mjs`, icons | web app PWA + push | |
| `services/approvals/wechat.js`, `checks/wechat-callback-signature.mjs` | api `/wechat/callback` | |
| `services/approvals/soter/server/server.js` (stable_token, code2Session, verify_signature) | soter-attester | Move inside the TEE; drop the spike's raw capture storage |
| `services/approvals/soter/miniprogram/*` (`app.js` login, `approve.js`, `support.js`, `project.config.json`) | apps/miniprogram | AppID of the test account comes from env/config |
| `services/approvals/soter/scripts/*`, `evidence/` (scrubbed) | soter-attester fixtures | Strip `uid`, `cpu_id`, openid before committing |
| `contracts/src/base/{RsaPssSha256,SoterVerifier}.sol`, `contracts/vendor/solarity` (MIT), `test/SoterVerifier.t.sol` | `contracts/base/src/roadmap/` | Not deployed in the product path; kept as evidence for the native-app SOTER roadmap |
| `contracts/src/base/WebAuthnVerifier.sol`, `RefusalLog.sol` | Reference only | Rewritten (RefusalLog now computes the reason) |
| `packages/protocol` (parity check, `make-vectors.mjs`, ProtocolVectors.t.sol pattern) | `packages/protocol` | New types from 02 |
| `services/identity/{scenario.sh, java/Scenario.java, weid-client.mjs, outputs-sample/}` | identity: weid-helper, weid-client, fixtures | Keep the 43-step scenario as an integration test |
| `infra/fisco/{setup-chain.sh, NOTES.md, quirks/}` | infra/fisco + fisco-client tests | |
| `infra/weid/*` (redacted configs, start/stop scripts) | services/identity configs | |
| `infra/wechat-devtools/{launch.sh, cli, NOTES.md}`, `infra/tunnels/NOTES.md` | infra | Linux DevTools port + NODE_OPTIONS fix; cloudflared `--protocol http2 --edge-ip-version 4` |
| `services/agent-mcp/opencode.json` | services/agent config | |
| `docs/*` reports (RISK_SPIKE, SOTER_REPORT, WEID_SPIKE_REPORT, WEID_REST_API, WECHAT_SETUP, test/status reports) | Knowledge, cited in 00/04/05 | `WECHAT_SETUP.md` drives Phase A |

### From BSA Sentry (`hliosone/bsa-sentry`)

| Source | Reuse for |
|---|---|
| `device-app/core/src/decide.rs` + `tests/decide.rs` | MandateHook decision order and its "rule vs neighbour" test style (port to Solidity + Foundry) |
| `apps/server/src/{oauth,mcp,auth}.ts` + tests | services/mcp (OAuth 2.1, DCR, PKCE, per-user bearer; tested with claude.ai) |
| `apps/server/src/age/{eudiw,routes}.ts` + tests | bank-service EUDI KYC path |
| `apps/web/src/state/statement.ts`, `test/statement.test.ts`, `test/fixtures/camt.053.001.02.xsd` | camt.053 export |
| `apps/web/src/components/Flex3D.tsx`, `FlexView.tsx` | Phone3D and its flat fallback |
| `apps/web/src/styles.css`, `pages/overview.css`, `spending.css`, `badge.css` | ui-tokens and component styles |
| `apps/web/src/state/{activity,feed,status}.ts`, `pages/Dashboard.tsx`, `Spending.tsx`, `HowItWorks.tsx`, `Landing.tsx` | Dashboard, feed, landing structure |
| `CLAUDE.md` (run mode A/B/C, TDD rules, "never stop" protocol), `docs/PHASE_C_GUIDE.md` format | Our CLAUDE.md and MANUAL.md |
| `docker-compose*.yml`, `Dockerfile`, `Makefile` | infra patterns |

### Third-party (licences to record)

webauthn-sol (MIT), FreshCryptoLib (MIT), solady (MIT), OpenZeppelin (MIT), forge-std (MIT/Apache-2.0), viem (MIT), permissionless.js if used (MIT), @simplewebauthn (MIT), web-push (MPL-2.0, unmodified dependency), three/R3F/drei (MIT), OpenCode (MIT), ant-intl-alipayplus-mcp (MIT), @phala/dstack-sdk (Apache-2.0), FISCO BCOS / WeIdentity / WeBASE / WeCross / BCOS3 stub (Apache-2.0), web3j (Apache-2.0), Safe (LGPL-3.0, deployed only), Safe7579 + launchpad (GPL-3.0, deployed only, own interfaces), DeepSeek models (DeepSeek License, via OpenCode Zen).
