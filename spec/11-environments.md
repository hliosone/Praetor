# 11 · Environments: local is a small prod

Rule: **the same images and the same compose files run on the laptop and on the server.** Only `.env` and one override file change. Nothing in code knows whether it runs locally.

## Environments

| `PRAETOR_ENV` | Where | Base | FISCO | TEEs | Public URL |
|---|---|---|---|---|---|
| `local` | Laptop, `compose.yml` | anvil fork of Base Sepolia (`CHAIN_MODE=fork`) | 4 nodes in Docker | dstack simulator (`ATTESTATION_MODE=simulator`) | `https://praetor.localhost` (Caddy internal CA) |
| `local-live` | Laptop | Base Sepolia live (`CHAIN_MODE=live`) | same | simulator | same, plus a cloudflared tunnel for phones |
| `rehearsal` | Laptop, `compose.yml` + `compose.prod.yml` | live | same | simulator (and the test that prod flags refuse it) | `https://praetor.localhost` |
| `prod` | HK server, `compose.yml` + `compose.prod.yml` | live | same, on the server | Phala Cloud CVMs (`ATTESTATION_MODE=phala`) | `https://app.<domain>` |

## Compose profiles (`infra/compose.yml`)

```
core      caddy, mysql, api, bundler, mcp, scheduler, oracle-feeder, notifier, web (static build served by caddy)
chain     fisco-node0..3, weid-rest, weid-helper, webase-front, bank, regulator, operator, bridge-relayer
wecross   wecross-router (JDK 8)
agent     agent (agent-runner + opencode)
tee-sim   dstack-simulator, agent-signer, soter-attester (same images as Phala)
mocks     kyc-vendor-mock, payout-partner, alipayplus-mock, wechatpay-mock
dev       anvil (fork), mailhog-like log sink, tunnel (cloudflared, optional)
```
`make up` = all profiles for the current env. Healthchecks on every service; dependants wait for `service_healthy`.

## Network and ports

Only Caddy publishes ports (80/443). Routes:
```
/            → web (static)          /api, /mp, /ws, /push, /wechat → api
/mcp, /oauth, /.well-known → mcp     /console → web (console routes) + api
/kyc-mock    → kyc-vendor-mock       /explorer → webase-front (behind console auth)
```
Everything else (FISCO RPC, WeIdentity REST, MySQL, OpenCode servers, TEEs, bundler, member services) is on the internal Docker network only. The exception locally is anvil on `127.0.0.1:18545` for Foundry tests. This makes "WeIdentity REST never exposed" true locally too.

## Configuration (`.env.example`, one variable per line, documented)

```
PRAETOR_ENV=local            PUBLIC_HOST=praetor.localhost     PUBLIC_URL=https://praetor.localhost
CHAIN_MODE=fork              BASE_RPC_URL=http://anvil:8545    BASE_LIVE_RPC_URL=https://sepolia.base.org
FORK_BLOCK=                  DEPLOYMENTS_FILE=infra/deployments/fork.json
FISCO_SM=0                   FISCO_RPC_URL=http://fisco-node0:8545   FISCO_GROUP=group0
BRIDGE=relayer|wecross       BRIDGE_WATCHDOG_S=120
ATTESTATION_MODE=simulator|phala   DSTACK_SIMULATOR_ENDPOINT=   AGENT_SIGNER_URL=  SOTER_ATTESTER_URL=   SOTER_COUNTER_STRICT=1
ALLOWED_COMPOSE_HASHES_AGENT=   ALLOWED_COMPOSE_HASHES_ATTESTER=
MP_APPID= MP_SECRET=         OA_APPID= OA_SECRET= OA_TOKEN= OA_TEMPLATE_ID=
VAPID_PUBLIC= VAPID_PRIVATE= VAPID_SUBJECT=
PYTH_API_KEY=                PYTH_HERMES_URL=https://pyth.dourolabs.app/hermes
AGENT_MODEL=opencode/deepseek-v4.1-flash-free   OPENCODE_API_KEY=   OPENCODE_SERVER_PASSWORD=
PRICE_CHECK_INTERVAL_S=30    HEARTBEAT_INTERVAL_S=60   HEARTBEAT_TTL_S=180      (prod: 900 / 300 / 900)
DEMO_SCALE=1                 (live: 100 → all demo amounts divided by 100)
SANDBOX_ENABLED=1            SOTER_FAKE_TENCENT=0 (tests only; refused when PRAETOR_ENV=prod)
keys (generated in Phase 0 by scripts/keys/generate.ts; prod: generated on the server, never copied from laptops):
DEPLOYER_KEY BUNDLER_KEY PAYMASTER_SIGNER_KEY ORACLE_FEEDER_KEY DESK_OPERATOR_KEY PAYOUT_PARTNER_KEY WECROSS_BASE_KEY
BANK_FISCO_KEY BANK_BASE_SIGNER_KEY REGULATOR_FISCO_KEY REGULATOR_BASE_SIGNER_KEY OPERATOR_FISCO_KEY OPERATOR_BASE_SIGNER_KEY
TREASURY_KEY RECOVERY_GUARDIAN_KEY (bank) SANDBOX_*_KEY (sandbox members, deployer, feeder)
SESSION_SECRET KYC_ENC_KEY KYC_VENDOR_HMAC MCP_OAUTH_SIGNING_KEY SIGNER_HMAC_MCP SIGNER_HMAC_API SIGNER_HMAC_BANK ATTESTER_HMAC_API
EUDI_VERIFIER_KEY EUDI_VERIFIER_CERT ALIPAYPLUS_TEST_MERCHANT_PRIVATE_KEY ALIPAYPLUS_TEST_GATEWAY_PUBLIC_KEY PHALA_CLOUD_API_KEY (deploy only)
WECHAT_API_BASE=https://api.weixin.qq.com (tests point it at the fake Tencent; refused when PRAETOR_ENV=prod) DEMO_HOLD_S=600 DOMAIN_NAME=Praetor-local|Praetor|Praetor-sandbox
MYSQL_ROOT_PASSWORD (+ one password per service DB)
```
Startup validation (zod) in every service, keyed on `PRAETOR_ENV` (only `prod` triggers the prod refusals, so the rehearsal can start with the simulator): missing or inconsistent config ⇒ refuse to start with a clear message. `PRAETOR_ENV=prod` additionally refuses: `ATTESTATION_MODE=simulator`, `SOTER_FAKE_TENCENT=1`, `CHAIN_MODE=fork`, default passwords, `SANDBOX_ENABLED` without rate limits (I13).

Contract addresses are never in env: `infra/deployments/<env>.json`, written by the deploy scripts, read by `packages/chain`.

## What runs where, and capacity

Praetor (the operator) runs every user's agent: users install and host nothing.

| Where | What | Notes |
|---|---|---|
| HK server (Docker) | web app (static), api, mcp, scheduler, bundler, notifier, oracle-feeder, agent-runner + one OpenCode instance per **active** user (started on wake or chat, stopped after 30 min idle), member services, bridge-relayer, WeCross router, 4 FISCO nodes, WeIdentity, WeBASE, MySQL, mocks, Caddy | Agents use CPU/RAM only while awake; the LLM itself runs elsewhere |
| Phala Cloud | agent-signer (one key per user, derived on demand), soter-attester | Two `tdx.small` CVMs |
| External | LLM inference (OpenCode Zen / DeepSeek), Base Sepolia RPC, Pyth Hermes, Tencent APIs | No GPU on our side |

Monitoring is free reads; the agent (and the LLM) is only woken when an asset leaves its band, when the user chats, or for an approval follow-up. No capacity limit: at hackathon scale (team + judges) the 16 GB server is enough; Phase 0 records the RAM of one OpenCode instance in PHASE0.md. Production: hosted agents are financed by a subscription, and scaling moves to a shared agent runtime with per-session tool scoping (roadmap).

## Phones against the local stack

- `make tunnel` starts cloudflared (`--protocol http2 --edge-ip-version 4`, Alex's working flags) in front of Caddy and writes the URL to `.run/tunnel-url`; the mini program's `config.js` and the WeChat OA callback URL are set from it.
- The mini program runs in **debug mode** (no domain allowlist). Passkeys created on the tunnel domain only work there: re-enrol on the real domain after deployment (expected).

## Prod transition (Phase C, after everything is green locally)

1. Buy the domain; DNS A record `app.<domain>` → HK server IP (DNS only, no proxy).
2. HK server (Tencent Cloud Lighthouse HK, 4 vCPU / 16 GB, Ubuntu LTS): Docker, firewall 80/443/22 only, non-root deploy user, unattended upgrades.
3. `scripts/deploy/server-bootstrap.sh`: clone repo, generate prod keys on the server, write `.env` (600), `make up` with `compose.prod.yml`.
4. Contracts: `make deploy-contracts ENV=base-sepolia` (if the live deployment from M16 isn't reused) → `deployments/base-sepolia.json`; FISCO contracts deployed on the server's chain.
5. TEEs: `phala deploy` both images with encrypted env (`-e`); read their compose hashes; bank registers them (`ALLOWED_COMPOSE_HASHES_*`, AttesterAttestation); set `ATTESTATION_MODE=phala`.
6. Set the WeChat OA callback URL and the mini program `config.js` to the domain; re-enrol passkeys.
7. `make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live` (smoke subset) → green; 17CE check from mainland cities.
8. `docs/DEPLOY.md` records every command and value (no secrets).
