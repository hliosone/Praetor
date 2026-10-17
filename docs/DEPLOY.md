# Deploying Praetor

> **Status on 2026-10-18.** The Base contracts are deployed on Base Sepolia (MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, `infra/deployments/base-sepolia.json`) from this laptop's `LIVE_` keys, and their consortium on the laptop's local FISCO chain (live mode, D74, D75). The production compose override, the rehearsal target and the prod refusal check exist (M18; the rehearsal gate is pending in `docs/PROGRESS.md`). The cloud deployment is a **Phase C step, done with the human** (spec 10) and has not happened; spec 11's server bootstrap script (`scripts/deploy/server-bootstrap.sh`) does not exist. This document gives the commands that exist, says plainly where the Makefile does not yet match spec 11, and is where Phase C records the values it uses (never a secret). Chinese version: [zh-CN/DEPLOY.md](zh-CN/DEPLOY.md).

## 1. Environments

The same images and the same compose file run on a laptop and on the server; only `.env` and one override file change (spec 11).

| Mode | How it starts | `PRAETOR_ENV` | Base | FISCO | TEEs | Public URL |
|---|---|---|---|---|---|---|
| local | `make up` (`infra/compose.yml`) | `local` | anvil fork of Base Sepolia (`CHAIN_MODE=fork`, `LOCAL_` keys) | 4 nodes in Docker | dstack simulator (`ATTESTATION_MODE=simulator`) | `https://praetor.localhost` (Caddy's internal CA) |
| local live | `make up LIVE=1` (adds `infra/live.env`) | `local` (not changed by `LIVE=1`) | Base Sepolia (`CHAIN_MODE=live`, `LIVE_` keys, no anvil) | the same local chain, governed by the `LOCAL` set (`FISCO_KEYSET=LOCAL`, D75) | simulator | same, plus `make tunnel` for phones |
| rehearsal | `make rehearsal` (`compose.yml` + `compose.prod.yml`) | `rehearsal` | `CHAIN_MODE` from `.env`: the fork unless `.env` sets the live values (the target does not pass `LIVE=1`) | same | simulator (the prod refusals are checked separately) | `https://praetor.localhost` |
| prod | the server, `compose.yml` + `compose.prod.yml` (section 9) | `prod` | Base Sepolia | the server's own 4 nodes | Phala Cloud CVMs (`ATTESTATION_MODE=phala`) | `https://app.<domain>` |

Only `PRAETOR_ENV=prod` triggers the production refusals, so the rehearsal can still start on the simulator.

## 2. Topology in production

- **One server** (spec 00: Tencent Cloud Lighthouse Hong Kong, 4 vCPU, 16 GB, Ubuntu LTS): Docker, firewall open on 22, 80 and 443 only, a non-root deploy user, unattended upgrades. It runs Caddy (an ACME certificate for `app.<domain>` through `CADDY_TLS`, DNS only, no CDN proxy), MySQL, the api, mcp, agent-runner with one OpenCode instance per awake user, the scheduler, bundler, notifier, oracle-feeder, the three member services, the bridge-relayer, the WeCross router and account manager, the four FISCO nodes, WeIdentity and the mocks.
- **Two Phala Cloud CVMs** (`tdx.small`, Intel TDX with dstack): `agent-signer` and `soter-attester`, two separate measurements.
- **External**: Base Sepolia RPC, the LLM (OpenCode Zen, DeepSeek), Pyth Hermes, Tencent's WeChat APIs, the browsers' push services.

## 3. Configuration and keys

- `.env` holds every key and secret, mode 600, git-ignored. `pnpm keys` fills only missing values (wallet keys in the three sets, shared secrets, the VAPID pair for web push) and prints public addresses only. Spec 11 generates production keys **on the server**; section 5 explains why reusing the existing Base deployment instead needs the laptop's `LIVE_` member keys there.
- Key sets (D1): `.env` holds `LOCAL_*`, `LIVE_*` and `SANDBOX_*` copies of every wallet key. `make up` writes `.run/compose.env` with the active set under the unprefixed names (`LIVE` when `CHAIN_MODE=live`, `LOCAL` otherwise); the FISCO-side keys come from `FISCO_KEYSET` when it is set (D75).
- The EIP-712 domain name must match the deployment: `DOMAIN_NAME=Praetor` for live Base Sepolia, `Praetor-sandbox` for the judges' own sandbox deployment (not built; the interim `/sandbox` page runs on the main deployment and its faucet refuses on live Base).
- Production values that differ from `infra/.env.example`:

| Variable | Production value |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `PUBLIC_HOST`, `PUBLIC_URL` | `app.<domain>`, `https://app.<domain>` (passkeys are bound to this host) |
| `CADDY_TLS` | the ACME account email (`compose.prod.yml` passes it to Caddy; `internal` by default) |
| `CHAIN_MODE`, `BASE_RPC_URL` | `live`, a Base Sepolia RPC |
| `DEPLOYMENTS_FILE`, `FISCO_DEPLOYMENTS_FILE` | `infra/deployments/base-sepolia.json`, `infra/deployments/fisco-live.json` |
| `DOMAIN_NAME` | `Praetor` |
| `ATTESTATION_MODE` | `phala` |
| `AGENT_SIGNER_URL`, `SOTER_ATTESTER_URL` | the two CVMs (section 7) |
| `ALLOWED_COMPOSE_HASHES_AGENT`, `ALLOWED_COMPOSE_HASHES_ATTESTER` | the CVMs' compose hashes (section 8) |
| `SOTER_FAKE_TENCENT`, `WECHAT_API_BASE` | `0`, `https://api.weixin.qq.com` |
| `MP_APPID`, `MP_SECRET`, `OA_*` | the human's WeChat values (the api and soter-attester both use `MP_*`) |
| `VAPID_SUBJECT` | a `mailto:` the push services can reach |
| `FAKE_LLM_URL` | empty (agent-runner refuses it in prod; `compose.prod.yml` never starts the scripted model) |
| `PRICE_CHECK_INTERVAL_S`, `HEARTBEAT_INTERVAL_S`, `HEARTBEAT_TTL_S` | `900`, `300`, `900` |
| `STANDING_ORDERS_INTERVAL_S`, `AUDIT_FROM`, `ANCHOR_INTERVAL_S` | `60`, `deploy`, `3600` |
| `BRIDGE`, `BRIDGE_WATCHDOG_S` | `wecross`, `120` |
| `DEMO_SCALE` | `100` on live Base Sepolia (Q30) |
| MySQL and OpenCode passwords | generated (prod refuses defaults) |

What `PRAETOR_ENV=prod` refuses today: simulator attestations (agent-signer, soter-attester, the bank, and the services that load `packages/config`); the fake Tencent and any other WeChat API base (soter-attester and the api); the fork, default passwords and an unthrottled sandbox (`packages/config`: bundler, bridge-relayer, member services); a fake LLM (agent-runner). `scripts/deploy/prod-refusals.sh` checks five of these services in the production compose. The [self-assessment](security/SELF_ASSESSMENT.md#5-known-risks) lists the gaps (known risk 25).

## 4. Fund the LIVE addresses

The live budget is deliberately small (D74): the human funds the deployer, and Base Sepolia's gas price (about 0.006 gwei when measured) makes the run cheap. The live run was planned within 0.0133 ETH on the deployer and 44 USDC on the treasury.

```bash
pnpm exec tsx scripts/deploy/fund-live.ts           # dry run: what each LIVE gas account lacks
pnpm exec tsx scripts/deploy/fund-live.ts --send    # sends it from the LIVE deployer
```

The script refuses any chain but 84532, keeps 0.006 ETH on the deployer (the deployment and its paymaster deposit) and tops up the bundler to 0.003 ETH, the WeCross Base account, the oracle feeder and the desk operator to 0.001 each, the payout partner and the treasury to 0.0005; it prints addresses and amounts only. It moves ETH only: the treasury's USDC comes from Circle's faucet (20 USDC per two hours). Consortium signer keys and every FISCO key need no ETH, and users never hold ETH: the paymaster sponsors their operations. The `SANDBOX_` set would be needed only for the own sandbox deployment, which is not built.

## 5. Deploy the Base contracts

```bash
DRY_RUN=1 make deploy-contracts ENV=base-sepolia                          # simulates: gas and cost, sends nothing
PAYMASTER_DEPOSIT_WEI=4000000000000000 make deploy-contracts ENV=base-sepolia
```

`scripts/deploy/contracts.sh` maps the `LIVE_` keys to the names `contracts/base/script/Deploy.s.sol` reads (without printing a value), deploys every contract with domain `Praetor`, wires the hook to its modules last, funds the paymaster deposit (0.02 ETH by default on live; 0.004 ETH above, about 1,600 sponsored operations) and writes `infra/deployments/base-sepolia.json`. The RPC is `BASE_LIVE_RPC_URL` (default `https://sepolia.base.org`). `make deploy-contracts ENV=sandbox` deploys with the `SANDBOX_` keys and domain `Praetor-sandbox`.

**The existing deployment.** On 2026-10-18 this sequence deployed Praetor on Base Sepolia at block 48253270 for about 0.0045 ETH in all. The hook's three member addresses are immutable constructor arguments (bank `0x9D45C4755CD26acAf3DAb12fE2c1B42AAdd1d52e`, regulator `0x5faaf3F8CC672A5357E648C9dfD81cD84d21e4e0`, operator `0x353046676e122D8eCb6F474A3aA57DBb338A525f`), so Phase C chooses one of two paths before it starts:

- **Reuse it**: the server holds the laptop's `LIVE_` member Base signer keys (and the other `LIVE_` keys Base trusts), which departs from spec 11's "generate prod keys on the server"; or
- **Redeploy**: the server generates its own keys with `pnpm keys`, the human funds its deployer, and sections 4 and 5 run again from the server.

`SOTER_COUNTER_STRICT` is a constructor flag of the hook (default true); if Phase C shows that the SOTER counter does not increase on iOS, a new deployment with `SOTER_COUNTER_STRICT=0` is needed (known risk 16).

## 6. Deploy the FISCO consortium

```bash
make deploy-fisco ENV=live               # writes infra/deployments/fisco-live.json, bound to base-sepolia.json
```

`scripts/fisco/deploy.ts` bootstraps FISCO governance once (regulator and operator as governors, rates 51/51, then the deploy whitelist: deployer, WeIdentity admin, WeCross FISCO account, Q22), then deploys the member registry, the boards, the audit log and the outbox, bound to the Base deployment of the same environment (hook address and domain name). It reaches FISCO at `FISCO_RPC_URL_HOST` (default `http://10.88.1.10:8545`, node0 on the Docker network), so it runs on the machine of the chain once the chain is up. The FISCO-side keys come from `FISCO_KEYSET`, else from the environment's set: on the laptop the live consortium was deployed with the `LOCAL` FISCO accounts on the local chain (D75), so today's `fisco-live.json` points at the laptop's chain; the server's own chain needs this command again, with its `LIVE_` FISCO keys. WeIdentity's contracts are deployed by the `weid-deploy` job of the compose file, WeCross's hub and proxy by `wecross-setup`.

## 7. TEEs on Phala Cloud

For each of `agent-signer` and `soter-attester`:

1. Build the image from the repository and push it to a registry; reference it **by digest** in the CVM's compose file (tee-checklist item 2).
2. Deploy the CVM with the Phala Cloud CLI (`phala`, version 1.1.22 pinned in Phase 0) or the dashboard, with `PRAETOR_ENV=prod`, `ATTESTATION_MODE=phala` and the secrets as **encrypted environment variables**: agent-signer `SIGNER_HMAC_MCP`, `SIGNER_HMAC_API`, `SIGNER_HMAC_BANK`; soter-attester `ATTESTER_HMAC_API`, `MP_APPID`, `MP_SECRET`, plus the deployments file for the domain and hook address. The exact commands are recorded in section 11 when they are run.
3. Read the CVM's app id and compose hash from the dashboard (or the service's `/v1/info`), and check it is a production, non-debug CVM.
4. Point the server's `AGENT_SIGNER_URL` and `SOTER_ATTESTER_URL` at the CVMs (TLS inside the CVM is an open item of the checklist, item 6).

Keys are derived inside the CVM (`getKey`), so the production agent keys differ from the simulator's: every existing account needs a new KYA and `SET_AGENT_KEY` for a key of the new TEE. The F10 rotation route (`POST /api/agent/rotate`) looks for the key Base holds among the TEE's key versions and finds none after a TEE change, so existing accounts would take the onboarding route instead (`POST /api/onboarding/agent/create`, then the mandate, the KYA and `SET_AGENT_KEY`). This path is read from the code and has **not been run** (neither the bank's KYA over an account that already has one from another TEE, nor a web app screen for it); check it in Phase C. Accounts created after the switch need nothing.

## 8. Register the compose hashes with the bank

1. Put the two compose hashes in the bank's `ALLOWED_COMPOSE_HASHES_AGENT` and `ALLOWED_COMPOSE_HASHES_ATTESTER` and restart the bank. With `ATTESTATION_MODE=phala` the bank refuses to start without an agent allowlist.
2. Activate the attester: the bank issues a nonce (`POST /attesters/nonce`), the attester's quote is verified through Phala's verifier (`POST /attesters/verify`), and the bank signs the `AttesterAttestation` with the verified measurement (D33). It reaches Base through the transport.
3. **Re-register on every change**: any change to an image or to a CVM compose file changes the hash; list the new hash before the new CVM serves, activate the new attester, and have any one member deactivate the old one (tee-checklist item 4).

If Phala's verify API is unreachable or answers differently, [MANUAL.md](MANUAL.md) step 2 gives the fallback. The full checklist: [security/tee-checklist.md](security/tee-checklist.md).

## 9. Start the stack

**Rehearsal on the laptop (M18):**

```bash
make rehearsal     # PRAETOR_ENV=rehearsal make up PROD=1, then make e2e-smoke (F1, F5, F8), then scripts/deploy/prod-refusals.sh
```

`compose.prod.yml` adds a restart policy for every long-running service and log rotation for all, moves the scripted model to a `test` profile, passes `CADDY_TLS` to Caddy and disables the plain-HTTP tunnel site. `prod-refusals.sh` runs the bank, agent-signer, soter-attester, agent-runner and the api once each with `PRAETOR_ENV=prod` and their test-only settings (simulator attestations, the fake Tencent, the fake LLM), and expects each to refuse to start.

**On the server (Phase C).** There is no server target yet:

```bash
git clone --recurse-submodules <repository> praetor && cd praetor
make setup                     # commit-msg hook, pnpm install --frozen-lockfile
pnpm keys                      # the server's keys into .env (mode 600), or the LIVE_ keys of section 5 if the deployment is reused
# fill the human values and the production values of section 3 into .env (CHAIN_MODE=live, CADDY_TLS, PUBLIC_HOST, ...)
```

What the Makefile does today, and the closest command:

- `make up PROD=1` adds `compose.prod.yml`, but without `LIVE=1` it still starts anvil (`up-base` and the default `dev` profile), and the default profiles include `tee-sim` (the TEE simulator).
- `LIVE=1` drops anvil and the `dev` profile, but exports `FISCO_KEYSET=LOCAL` (D75, a laptop choice) and adds `infra/live.env`, whose values override `.env`.
- Until a server target exists, the closest command is the following. It has **not been run**; check it in Phase C:

```bash
make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"
make deploy-fisco ENV=live     # the server's chain (section 6)
make down && make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"   # services reread fisco-live.json
```

Then register the TEEs (sections 7 and 8) and onboard accounts.

## 10. Tunnels, phones and the mini program domain

- **Phones against a laptop stack** (local or `make up LIVE=1`): `make tunnel` starts a cloudflared quick tunnel (`--protocol http2 --edge-ip-version 4`, the Phase 0 flags) to Caddy over plain HTTP on the machine, writes its URL to `.run/tunnel-url` and points the mini program's develop environment at it; `make tunnel-stop` ends it. Each start gives a new address. `compose.prod.yml` disables the tunnel site, so it is never used with the production compose. Steps for testers: [TESTER.md](TESTER.md).
- **Passkeys are bound to the host** (WebAuthn rpId): for Face ID in a phone's browser against a laptop stack, set `PUBLIC_HOST` and `PUBLIC_URL` to the tunnel's address and run `make up` again; the automated suites then do not apply (they expect `praetor.localhost`). Passkeys created on `praetor.localhost` or a tunnel only work there: re-enrol on `app.<domain>` after deployment.
- **Mini program**: it runs on the team's phones in **debug mode** under the WeChat test account, so no domain allowlist applies. Point its release environment at the domain with `node apps/miniprogram/scripts/set-api-base.mjs release https://app.<domain>`; the Official Account callback URL moves to the domain too.

## 11. Smoke check and record

Spec 11 step 7 asks for `make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live`. The suites do not read `BASE_URL` yet: `scripts/demo/lib.ts` fixes the origin to `https://praetor.localhost` and reaches the services on the Docker network (10.88.x), and `make e2e` ends with the 48 h warp test, which needs anvil. What exists: `make rehearsal` on a laptop and `make e2e-smoke` against a stack on the same machine. Against the deployed domain the check is manual until the suites take the host from the environment: [MANUAL.md](MANUAL.md) steps 4, 8 and 11 on `https://app.<domain>`, then a reachability check from mainland China cities (17CE).

Record below what was deployed (no secrets):

| Item | Value |
|---|---|
| Date, commit | Phase C |
| Domain, server | Phase C |
| Base deployment | `infra/deployments/base-sepolia.json`: MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, block 48253270, deployed 2026-10-18 from the laptop's `LIVE_` keys; Phase C: reused or redeployed (section 5) |
| FISCO deployment | `infra/deployments/fisco-live.json`: today on the laptop's local chain (D75); Phase C: the server's chain |
| agent-signer CVM: app id, compose hash | Phase C |
| soter-attester CVM: app id, compose hash | Phase C |
| Commands run | Phase C |
