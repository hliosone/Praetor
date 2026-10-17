# Deploying Praetor

> **Status at M17.** Deployment to the cloud is a **Phase C step, done with the human** (spec 10); it has not happened yet. The production compose overrides (`infra/compose.prod.yml`) and the deployment rehearsal are **built in M18** by the lead; the server bootstrap script of spec 11 (`scripts/deploy/server-bootstrap.sh`) does not exist yet. This document gives the plan and the commands that exist today, and is where Phase C records the values it uses (never a secret). Chinese version: `docs/zh-CN/DEPLOY.md`.

## 1. Environments

The same images and the same compose file run on a laptop and on the server; only `.env` and one override file change (spec 11).

| `PRAETOR_ENV` | Where | Base | FISCO | TEEs | Public URL |
|---|---|---|---|---|---|
| `local` | laptop, `infra/compose.yml` | anvil fork of Base Sepolia (`CHAIN_MODE=fork`) | 4 nodes in Docker | dstack simulator (`ATTESTATION_MODE=simulator`) | `https://praetor.localhost` (Caddy's internal CA) |
| `local-live` | laptop | Base Sepolia (`CHAIN_MODE=live`) | same | simulator | same, plus a tunnel for phones |
| `rehearsal` | laptop, `compose.yml` + `compose.prod.yml` (M18) | live | same | simulator (the prod refusals are tested separately) | `https://praetor.localhost` |
| `prod` | server, `compose.yml` + `compose.prod.yml` (M18) | live | same, on the server | Phala Cloud CVMs (`ATTESTATION_MODE=phala`) | `https://app.<domain>` |

Only `PRAETOR_ENV=prod` triggers the production refusals, so the rehearsal can still start on the simulator.

## 2. Topology in production

- **One server** (spec 00: Tencent Cloud Lighthouse Hong Kong, 4 vCPU, 16 GB, Ubuntu LTS): Docker, firewall open on 22, 80 and 443 only, a non-root deploy user, unattended upgrades. It runs Caddy (Let's Encrypt for `app.<domain>`, DNS only, no CDN proxy), MySQL, the api, mcp, agent-runner with one OpenCode instance per awake user, the scheduler, bundler, notifier, oracle-feeder, the three member services, the bridge-relayer, the WeCross router and account manager, the four FISCO nodes, WeIdentity and the mocks.
- **Two Phala Cloud CVMs** (`tdx.small`, Intel TDX with dstack): `agent-signer` and `soter-attester`, two separate measurements.
- **External**: Base Sepolia RPC, the LLM (OpenCode Zen, DeepSeek), Pyth Hermes, Tencent's WeChat APIs.

## 3. Configuration and keys

- `.env` holds every key and secret, mode 600, git-ignored. Production keys are **generated on the server** with `pnpm keys`, never copied from a laptop. The generator only fills missing values and prints public addresses only.
- Key sets (D1): `.env` holds `LOCAL_*`, `LIVE_*` and `SANDBOX_*` copies of every wallet key. A service reads the **unprefixed** name first, then the active set's prefix (`LIVE` when `CHAIN_MODE=live`, `LOCAL` otherwise, or the set named by `KEY_SET`). On the production server either fill the unprefixed names or run with the `LIVE_` set.
- The EIP-712 domain name must match the deployment: `DOMAIN_NAME=Praetor` for live Base Sepolia, `Praetor-sandbox` for the judges' sandbox.
- Production values that differ from `infra/.env.example`:

| Variable | Production value |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `CHAIN_MODE`, `BASE_RPC_URL` | `live`, a Base Sepolia RPC |
| `DEPLOYMENTS_FILE`, `FISCO_DEPLOYMENTS_FILE` | `infra/deployments/base-sepolia.json`, `infra/deployments/fisco-live.json` |
| `DOMAIN_NAME` | `Praetor` |
| `ATTESTATION_MODE` | `phala` |
| `ALLOWED_COMPOSE_HASHES_AGENT`, `ALLOWED_COMPOSE_HASHES_ATTESTER` | the CVMs' compose hashes (section 7) |
| `SOTER_FAKE_TENCENT`, `WECHAT_API_BASE` | `0`, `https://api.weixin.qq.com` |
| `MP_APPID`, `MP_SECRET`, `OA_*` | the human's WeChat values (Phase A) |
| `FAKE_LLM_URL` | empty (agent-runner refuses it in prod) |
| `PRICE_CHECK_INTERVAL_S`, `HEARTBEAT_INTERVAL_S`, `HEARTBEAT_TTL_S` | `900`, `300`, `900` |
| `STANDING_ORDERS_INTERVAL_S`, `AUDIT_FROM`, `ANCHOR_INTERVAL_S` | `60`, `deploy`, `3600` |
| `BRIDGE`, `BRIDGE_WATCHDOG_S` | `wecross`, `120` |
| `DEMO_SCALE` | `100` on live Base Sepolia (Q30) |
| MySQL and OpenCode passwords | generated (prod refuses defaults) |

What `PRAETOR_ENV=prod` refuses today: simulator attestations (agent-signer, soter-attester, bank, and the services using `packages/config`), the fake Tencent and any other WeChat API base (soter-attester), the fork, default passwords and an unthrottled sandbox (`packages/config`: bundler, bridge-relayer, member services), and a fake LLM (agent-runner). The [self-assessment](security/SELF_ASSESSMENT.md#5-known-risks) lists the gaps (known risk 25).

## 4. Fund the LIVE addresses

[QUESTIONS.md, section "Funding"](QUESTIONS.md#funding-before-go) lists each LIVE address, the amount and why: about **0.091 ETH and 100 USDC** on Base Sepolia for the deployer (contracts and the paymaster deposit), the bundler, the WeCross Base account, the oracle feeder, the desk operator, the payout partner and the treasury (USDC from Circle's faucet, 20 USDC per two hours). Consortium signer keys and every FISCO key need no ETH. Users never hold ETH: the paymaster sponsors their operations. The SANDBOX set (about 0.086 ETH, its own "pUSD") is needed only for the judges' sandbox. At M17 no LIVE address is funded yet ([BLOCKERS.md](BLOCKERS.md), B1).

## 5. Deploy the Base contracts

```bash
make deploy-contracts ENV=base-sepolia   # LIVE_ keys, domain "Praetor", writes infra/deployments/base-sepolia.json
make deploy-contracts ENV=sandbox        # SANDBOX_ keys, domain "Praetor-sandbox", writes infra/deployments/sandbox.json
```

`scripts/deploy/contracts.sh` maps the set's keys to the names `contracts/base/script/Deploy.s.sol` reads (without printing a value), deploys every contract, wires the hook to its modules last, and funds the paymaster deposit (0.02 ETH on live). The RPC is `BASE_LIVE_RPC_URL` (default `https://sepolia.base.org`). `SOTER_COUNTER_STRICT` is a constructor flag of the hook (default true); if Phase C shows that the SOTER counter does not increase on iOS, it must be set before this step (known risk 16). The M16 live deployment may be reused instead of redeploying.

## 6. Deploy the FISCO consortium

```bash
make deploy-fisco ENV=live               # writes infra/deployments/fisco-live.json, bound to base-sepolia.json
```

`scripts/fisco/deploy.ts` bootstraps FISCO governance once (regulator and operator as governors, rates 51/51, then the deploy whitelist: deployer, WeIdentity admin, WeCross FISCO account, Q22), then deploys the member registry, the boards, the audit log and the outbox, bound to the Base deployment of the same environment (hook address and domain name). It reaches FISCO at `FISCO_RPC_URL_HOST` (default `http://10.88.1.10:8545`, node0 on the Docker network), so it runs on the server once the chain is up. WeIdentity's contracts are deployed by the `weid-deploy` job of the compose file, WeCross's hub and proxy by `wecross-setup`.

## 7. TEEs on Phala Cloud

For each of `agent-signer` and `soter-attester`:

1. Build the image from the repository and push it to a registry; reference it **by digest** in the CVM's compose file (tee-checklist item 2).
2. Deploy the CVM with the Phala Cloud CLI (`phala`, version 1.1.22 pinned in Phase 0) or the dashboard, with `PRAETOR_ENV=prod`, `ATTESTATION_MODE=phala` and the secrets as **encrypted environment variables**: agent-signer `SIGNER_HMAC_MCP`, `SIGNER_HMAC_API`, `SIGNER_HMAC_BANK`; soter-attester `ATTESTER_HMAC_API`, `MP_APPID`, `MP_SECRET`, plus the deployments file for the domain and hook address. The exact commands are recorded in section 11 when they are run.
3. Read the CVM's app id and compose hash from the dashboard (or the service's `/v1/info`), and check it is a production, non-debug CVM.
4. Point the server's `AGENT_SIGNER_URL` and `SOTER_ATTESTER_URL` at the CVMs (TLS inside the CVM is an open item of the checklist, item 6).

Keys are derived inside the CVM (`getKey`), so the production agent keys differ from the simulator's: every account needs a new KYA and `SET_AGENT_KEY` for its production agent key (flow F10, built in M15).

## 8. Register the compose hashes with the bank

1. Put the two compose hashes in the bank's `ALLOWED_COMPOSE_HASHES_AGENT` and `ALLOWED_COMPOSE_HASHES_ATTESTER` and restart the bank. With `ATTESTATION_MODE=phala` the bank refuses to start without an agent allowlist.
2. Activate the attester: the bank issues a nonce (`POST /attesters/nonce`), the attester's quote is verified through Phala's verifier (`POST /attesters/verify`), and the bank signs the `AttesterAttestation` with the verified measurement (D33). It reaches Base through the transport.
3. **Re-register on every change**: any change to an image or to a CVM compose file changes the hash; list the new hash before the new CVM serves, activate the new attester, and have any one member deactivate the old one (tee-checklist item 4).

If Phala's verify API is unreachable or answers differently, [MANUAL.md](MANUAL.md) step 2 gives the fallback. The full checklist: [security/tee-checklist.md](security/tee-checklist.md).

## 9. Start the stack on the server

```bash
git clone --recurse-submodules <repository> praetor && cd praetor
make setup                     # commit-msg hook, pnpm install --frozen-lockfile
pnpm keys                      # generates the server's keys into .env (mode 600), prints public addresses only
# fill the human values and the production values of section 3 into .env
make up                        # today: compose.yml only; the prod overrides (Caddy with Let's Encrypt, restart
                               # policies, no anvil, live Base) come with infra/compose.prod.yml in M18
```

Then deploy the contracts (sections 5 and 6) if not done, register the TEEs (sections 7 and 8), and seed or onboard accounts.

## 10. Tunnels, phones and the mini program domain

- **Phones against a local stack**: spec 11's `make tunnel` (cloudflared with `--protocol http2 --edge-ip-version 4`, URL in `.run/tunnel-url`) is still a stub that exits with an error; until it lands, run cloudflared by hand in front of Caddy.
- **Mini program** (built in M14): it runs on the team's phones in **debug mode** on the WeChat test account, so no domain allowlist applies; its `config.js` and the Official Account callback URL point at the public host (the tunnel URL, then `app.<domain>`).
- **Passkeys are bound to the domain** (WebAuthn rpId): passkeys created on `praetor.localhost` or a tunnel only work there; re-enrol on the real domain after deployment.

## 11. Smoke check and record

```bash
make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live    # smoke subset against the deployment
```

Then a reachability check from mainland China cities (17CE). Record below what was deployed (no secrets):

| Item | Value |
|---|---|
| Date, commit | Phase C |
| Domain, server | Phase C |
| Base deployment | `infra/deployments/base-sepolia.json` (Phase C) |
| FISCO deployment | `infra/deployments/fisco-live.json` (Phase C) |
| agent-signer CVM: app id, compose hash | Phase C |
| soter-attester CVM: app id, compose hash | Phase C |
| Commands run | Phase C |
