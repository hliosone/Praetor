# Deploying Praetor

> **Status on 2026-10-19.** The Base contracts are deployed on Base Sepolia for the server (MandateHook `0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`, `infra/deployments/base-sepolia.json`, D101) from this laptop's `LIVE_` keys; the server deploys their FISCO consortium on its own chain (section 6). The M16 deployment of 2026-10-18 (MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, `infra/deployments/base-sepolia-m16.json`) keeps its consortium on the laptop's local FISCO chain (live mode, D74, D75), which today's `infra/deployments/fisco-live.json` still names. The production compose override, the rehearsal target and the prod refusal check exist, and the rehearsal passed on the fork on 2026-10-18 (M18, D90; section 9). The cloud deployment is a **Phase C step, done with the human** (spec 10) and has not happened. The server is a Google Cloud VM in Hong Kong (section 2). Its scripts exist and were tested on this laptop only, never against a server or Phala Cloud: `scripts/deploy/server-bootstrap.sh` (run twice in an `ubuntu:24.04` container), `scripts/deploy/build-images.sh`, and the TEE files `infra/phala/*.compose.yml` with `scripts/deploy/phala-deploy.sh` (against stub commands, section 7). Section 9 gives the server procedure in order. This document gives the commands that exist, says plainly where the Makefile does not yet match spec 11, and is where Phase C records the values it uses (never a secret). Chinese version: [zh-CN/DEPLOY.md](zh-CN/DEPLOY.md).

## 1. Environments

The same images and the same compose file run on a laptop and on the server; only `.env` and one override file change (spec 11).

| Mode | How it starts | `PRAETOR_ENV` | Base | FISCO | TEEs | Public URL |
|---|---|---|---|---|---|---|
| local | `make up` (`infra/compose.yml`) | `local` | anvil fork of Base Sepolia (`CHAIN_MODE=fork`, `LOCAL_` keys) | 4 nodes in Docker | dstack simulator (`ATTESTATION_MODE=simulator`) | `https://praetor.localhost` (Caddy's internal CA) |
| local live | `make up LIVE=1` (adds `infra/live.env`) | `local` (not changed by `LIVE=1`) | Base Sepolia (`CHAIN_MODE=live`, `LIVE_` keys, no anvil; read through `https://base-sepolia-rpc.publicnode.com`, D92, in log windows of `BASE_LOGS_MAX_RANGE` blocks, D98) | the same local chain, governed by the `LOCAL` set (`FISCO_KEYSET=LOCAL`, D75) | simulator | same, plus `make tunnel` for phones |
| rehearsal | `make rehearsal` (`compose.yml` + `compose.prod.yml`) | `rehearsal` | `CHAIN_MODE` from `.env`: the fork unless `.env` sets the live values (the target does not pass `LIVE=1`) | same | simulator (the prod refusals are checked separately) | `https://praetor.localhost` |
| prod | the server, `compose.yml` + `compose.prod.yml` (section 9) | `prod` | Base Sepolia | the server's own 4 nodes | Phala Cloud CVMs (`ATTESTATION_MODE=phala`) | `https://app.<domain>` |

Only `PRAETOR_ENV=prod` triggers the production refusals, so the rehearsal can still start on the simulator.

## 2. Topology in production

- **One server**: a Google Cloud Compute Engine VM in `asia-east2` (Hong Kong), `e2-standard-4` (4 vCPU, 16 GB, x86_64), Ubuntu 24.04 LTS (the standard image, not Minimal), an 80 GB balanced persistent disk and a static external IPv4. The VPC firewall allows tcp 22, 80 and 443 only; `scripts/deploy/server-bootstrap.sh` adds Docker, ufw with the same three ports, a non-root deploy user and unattended upgrades. Spec 00 named Tencent Cloud Lighthouse Hong Kong, whose identity check takes 2 to 4 working days: it remains the alternative, with the same script and procedure and the Lighthouse firewall in place of the VPC rules. The default VPC's `asia-east2` subnet is `10.170.0.0/20`, and every subnet of an auto-mode VPC lies in `10.128.0.0/9`, clear of the stack's Docker networks (`10.88.0.0/16`, `10.89.0.0/24`, `10.90.0.0/24`); the bootstrap refuses a host with a route inside them, and lowers Docker's bridges to the VPC's 1460-byte MTU. It runs Caddy (an ACME certificate for `app.<domain>` through `CADDY_TLS`, DNS only, no CDN proxy), MySQL, the api, mcp, agent-runner with one OpenCode instance per awake user, the scheduler, bundler, notifier, oracle-feeder, the three member services, the bridge-relayer, the WeCross router and account manager, the four FISCO nodes, WeIdentity and the mocks.
- **Two Phala Cloud CVMs** (`tdx.small`: 1 vCPU, 2 GB, Intel TDX with dstack, 0.058 USD an hour each): `agent-signer` and `soter-attester`, two separate measurements. On 2026-10-19 the workspace lists only `US-WEST-1` nodes, so each TEE call goes from Hong Kong to the US west coast, and about 5 USD of credit runs both CVMs for about 43 hours.
- **External**: Base Sepolia RPC, the LLM (OpenCode Zen, DeepSeek), Pyth Hermes, Tencent's WeChat APIs, the browsers' push services.

## 3. Configuration and keys

- `.env` holds every key and secret, mode 600, git-ignored. `pnpm keys` fills only missing values (wallet keys in the three sets, shared secrets, the VAPID pair for web push) and prints public addresses only. Spec 11 generates production keys **on the server**; the server instead reuses the laptop's funded `LIVE_` keys for a new Base deployment (section 5, D100), and `pnpm keys` generates its shared secrets.
- Key sets (D1): `.env` holds `LOCAL_*`, `LIVE_*` and `SANDBOX_*` copies of every wallet key. `make up` writes `.run/compose.env` with the active set under the unprefixed names (`LIVE` when `CHAIN_MODE=live`, `LOCAL` otherwise); the FISCO-side keys come from `FISCO_KEYSET` when it is set (D75).
- The EIP-712 domain name must match the deployment: `DOMAIN_NAME=Praetor` for live Base Sepolia, `Praetor-sandbox` for the judges' own sandbox deployment (not built; the interim `/sandbox` page runs on the main deployment and its faucet refuses on live Base).
- Production values that differ from `infra/.env.example`:

| Variable | Production value |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `PUBLIC_HOST`, `PUBLIC_URL` | `app.<domain>`, `https://app.<domain>` (passkeys are bound to this host) |
| `CADDY_TLS` | the ACME account email (`compose.prod.yml` passes it to Caddy; `internal` by default) |
| `CHAIN_MODE`, `BASE_RPC_URL`, `BASE_LOGS_MAX_RANGE` | `live`, a Base Sepolia RPC that serves wide `eth_getLogs` ranges: `https://base-sepolia-rpc.publicnode.com`, as in `infra/live.env` (D92), and `10000`. `sepolia.base.org` caps `eth_getLogs` at 200 blocks, publicnode at 50,000. Every Base log read (payout partner, scheduler, api, notifier, oracle feeder, reader, audit writer) goes in windows of at most `BASE_LOGS_MAX_RANGE` blocks, so the range from the deployment block can grow for as long as the server runs (D98); set it to 200 or less on an RPC like `sepolia.base.org` |
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

The live budget is deliberately small (D74): the human funds the deployer, and Base Sepolia's gas price (about 0.006 gwei when measured) makes the run cheap. The live run was planned within 0.0133 ETH on the deployer and 44 USDC on the treasury, and the M16 evidence run of 2026-10-18 stayed within it (D74, D96).

```bash
pnpm exec tsx scripts/deploy/fund-live.ts           # dry run: what each LIVE gas account lacks
pnpm exec tsx scripts/deploy/fund-live.ts --send    # sends it from the LIVE deployer
```

The script refuses any chain but 84532, keeps 0.006 ETH on the deployer (the deployment and its paymaster deposit) and tops up the bundler to 0.003 ETH, the WeCross Base account, the oracle feeder and the desk operator to 0.001 each, the payout partner and the treasury to 0.0005; it prints addresses and amounts only. It moves ETH only: the treasury's USDC comes from Circle's faucet (20 USDC per two hours). Consortium signer keys and every FISCO key need no ETH, and users never hold ETH: the paymaster sponsors their operations. The `SANDBOX_` set would be needed only for the own sandbox deployment, which is not built.

## 5. Deploy the Base contracts

```bash
DRY_RUN=1 PAYMASTER_DEPOSIT_WEI=4000000000000000 make deploy-contracts ENV=base-sepolia   # simulates: gas and cost, sends nothing
PAYMASTER_DEPOSIT_WEI=4000000000000000 make deploy-contracts ENV=base-sepolia
```

`scripts/deploy/contracts.sh` maps the `LIVE_` keys to the names `contracts/base/script/Deploy.s.sol` reads (without printing a value), deploys every contract with domain `Praetor`, wires the hook to its modules last, funds the paymaster deposit (0.02 ETH by default on live; 0.004 ETH above, about 1,600 sponsored operations) and writes `infra/deployments/base-sepolia.json`. The RPC is `BASE_LIVE_RPC_URL` (default `https://sepolia.base.org`). `make deploy-contracts ENV=sandbox` deploys with the `SANDBOX_` keys and domain `Praetor-sandbox`.

**The deployments.** On 2026-10-18 this sequence deployed Praetor on Base Sepolia at block 48253270 for about 0.0045 ETH in all (MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, the M16 evidence run, now `base-sepolia-m16.json`). On 2026-10-19 it deployed again for the server, from the same keys, at block 48301428 (MandateHook `0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`, paymaster `0x046922c731253E268B1856479D08a10b10Fa8314`, `base-sepolia.json`, D101): 38 transactions, 19.7M gas, 0.000118 ETH plus a 0.003 ETH paymaster deposit, after taking back the M16 paymaster's 0.0039835 ETH. The hook's three member addresses are immutable constructor arguments, the same in both (bank `0x9D45C4755CD26acAf3DAb12fE2c1B42AAdd1d52e`, regulator `0x5faaf3F8CC672A5357E648C9dfD81cD84d21e4e0`, operator `0x353046676e122D8eCb6F474A3aA57DBb338A525f`).

**The server gets a new Base deployment from the same `LIVE_` keys; do not put a new FISCO chain behind this one (D100).** The hook takes a consortium message only with the next nonce of its key (`ConsortiumLib._fresh`: `nonce == stored + 1`; `Anchor`: `seq == stored + 1`; I18), and a fresh FISCO consortium numbers every key from 1 again (`Board._allocate`). On 2026-10-19 the hook held heartbeat epoch 6, anchor seq 3, the caps of profile 2 at nonce 1 and the assets active. With the server's new chain behind it:

- `bootstrapConsortium` (`scripts/demo/lib.ts`) reads Base, finds the caps and assets set and opens no proposal, so the server's `MandateRegistry` and `AssetRegistry` stay empty and every policy check (`submitPolicy`) fails `RULE_HARD_CAP` or `RULE_ASSET_NOT_ACTIVE`: onboarding stops at the mandate.
- Opening them anyway changes nothing on Base: the relayer finds the hook already at those nonces (`BadNonce`, marked already applied) and Base keeps its old values.
- Heartbeat epochs 1 to 6 and anchors 1 to 3 are dropped the same way: Base stays stale, so every agent payment is `STALE_STATUS`, until epoch 7, and anchors resume only at seq 4.

Done on 2026-10-19 from the laptop (it has forge, the submodules and `.env`), before the server clones the repository (D101):

```bash
cp infra/deployments/base-sepolia.json infra/deployments/base-sepolia-m16.json   # the M16 addresses stay on record
# 1. Take back the old paymaster's EntryPoint deposit (about 0.004 ETH): its owner is the LIVE deployer.
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032; OLD_PM=0x1A5514F4752683b2f7e032c36529260dacf98c94; RPC=https://sepolia.base.org
DEP=$(cast call $EP "balanceOf(address)(uint256)" $OLD_PM --rpc-url $RPC | cut -d' ' -f1)
cast send $OLD_PM "withdrawTo(address,uint256)" 0x7b5bB06482513F6032baD053018ee387A7dac771 $DEP \
  --private-key "$(grep -E '^LIVE_DEPLOYER_KEY=' .env | cut -d= -f2-)" --rpc-url $RPC
# 2. Simulate, then deploy with a 0.003 ETH paymaster deposit.
DRY_RUN=1 PAYMASTER_DEPOSIT_WEI=3000000000000000 make deploy-contracts ENV=base-sepolia
PAYMASTER_DEPOSIT_WEI=3000000000000000 make deploy-contracts ENV=base-sepolia
# 3. Commit infra/deployments/base-sepolia.json and base-sepolia-m16.json, push.
```

- **Cost**: the 2026-10-18 deployment took 42 transactions and about 30.4M gas, about 0.0002 ETH at 0.006 gwei, plus the new paymaster deposit. The deployer held about 0.0023 ETH on 2026-10-19, so taking back the old deposit comes first, not as an option; with it the redeploy roughly pays for itself. The member, feeder, desk operator, paymaster signer and treasury addresses stay the same, so nothing else needs funding. The new `deployBlock` also restarts the `eth_getLogs` range (D92, D98).
- **The dry run** must carry the same `PAYMASTER_DEPOSIT_WEI` (the live default is 0.02 ETH, more than the deployer holds), and must follow the withdrawal (it simulates the deposit against the deployer's balance). It runs `Deploy.s.sol` without broadcasting, and the script writes `infra/deployments/base-sepolia.json` (`vm.writeJson`) even then: if you stop after it, or the deployment fails, restore the file with `git checkout infra/deployments/base-sepolia.json`.
- **Order**: the service images bake `infra/deployments` in, so commit the new file before the server clones and builds. Section 6 then deploys the server's consortium bound to the new hook.
- **Keys**: the server holds the laptop's `LIVE_` keys (the funded addresses Base trusts), which departs from spec 11's "generate prod keys on the server"; `pnpm keys` on the server still generates every shared secret fresh. A deployment from fresh server keys would also work, but the human would fund every new address again (section 4). Once the server is live, the laptop never runs live mode again: both would send from the same `LIVE_` addresses (D97).
- **The M16 deployment** keeps no sponsorship once its deposit is withdrawn (intended); `docs/EVIDENCE.md` keeps citing its addresses, backed by `base-sepolia-m16.json`.

`SOTER_COUNTER_STRICT` is a constructor flag of the hook (default true); if Phase C shows that the SOTER counter does not increase on iOS, a new deployment with `SOTER_COUNTER_STRICT=0` is needed (known risk 16).

## 6. Deploy the FISCO consortium

```bash
make deploy-fisco ENV=live               # writes infra/deployments/fisco-live.json, bound to base-sepolia.json
```

`scripts/fisco/deploy.ts` bootstraps FISCO governance once (regulator and operator as governors, rates 51/51, then the deploy whitelist: deployer, WeIdentity admin, WeCross FISCO account, Q22), then deploys the member registry, the boards, the audit log and the outbox, bound to the Base deployment of the same environment (hook address and domain name). It reaches FISCO at `FISCO_RPC_URL_HOST` (default `http://10.88.1.10:8545`, node0 on the Docker network), so it runs on the machine of the chain once the chain is up. The FISCO-side keys come from `FISCO_KEYSET`, else from the environment's set: on the laptop the live consortium was deployed with the `LOCAL` FISCO accounts on the local chain (D75), so today's `fisco-live.json` points at the laptop's chain; the server's own chain needs this command again, with its `LIVE_` FISCO keys. WeIdentity's contracts are deployed by the `weid-deploy` job of the compose file, WeCross's hub and proxy by `wecross-setup`.

## 7. TEEs on Phala Cloud

The CVMs' compose files are `infra/phala/agent-signer.compose.yml` and `infra/phala/soter-attester.compose.yml`; `scripts/deploy/phala-deploy.sh` builds, pushes and deploys them. Neither has run against Phala Cloud (`test/infra/phala-deploy.test.ts` runs the script against stub `docker` and `phala` commands).

- **What is measured.** Each file runs one service with `PRAETOR_ENV=prod`, `ATTESTATION_MODE=phala` and the dstack socket (`/var/run/dstack.sock`), from an image **by digest** (tee-checklist item 2). Everything written in the file goes into the CVM's compose hash: the image digest; agent-signer's `PUBLIC_URL` (it signs agent cards only for `<PUBLIC_URL>/mcp`, so the domain comes first); soter-attester's `DEPLOYMENTS_FILE`, the `base-sepolia.json` baked into its image (rebuild after a Base redeployment); the real WeChat API base. The list of encrypted variable names (`allowed_envs`) and the public log and sysinfo flags count too; the secret values do not, so changing a value alone keeps the hash.
- **Encrypted environment variables**, the only inputs not measured: agent-signer `SIGNER_HMAC_MCP`, `SIGNER_HMAC_API`, `SIGNER_HMAC_BANK`; soter-attester `ATTESTER_HMAC_API`, `MP_APPID`, `MP_SECRET`; for a private image both also get `DSTACK_DOCKER_REGISTRY`, `DSTACK_DOCKER_USERNAME` and `DSTACK_DOCKER_PASSWORD`, with which Phala's pre-launch script logs in before pulling. The HMACs must equal the server's: section 9 copies them from the laptop's `.env` to the server's.
- **Commands**, on the laptop (it has `phala` 1.1.22, the API key in `.env` and Docker). The script refuses to do anything without `PHALA_CONFIRM=1`:

```bash
gh auth refresh -s write:packages && gh auth token | docker login ghcr.io -u hliosone --password-stdin   # once: today's gh token cannot push packages
PHALA_CONFIRM=1 REGISTRY=ghcr.io/hliosone scripts/deploy/phala-deploy.sh build   # git archive HEAD, build, push; digests in .run/phala/images.env
PHALA_CONFIRM=1 PUBLIC_URL=https://app.<domain> scripts/deploy/phala-deploy.sh deploy
export PHALA_CLOUD_API_KEY="$(grep -E '^PHALA_CLOUD_API_KEY=' .env | cut -d= -f2-)"   # the CLI is not logged in on the laptop
phala cvms get praetor-agent-signer --json; phala cvms get praetor-soter-attester --json   # app id, compose hash, endpoints
```

  `build` builds both images from the committed tree (no untracked file, no uncommitted change), prints the commit and the hook baked into soter-attester, and pushes them. Build from the commit the server runs, or at least one with the same `infra/deployments/base-sepolia.json`. `deploy` creates `praetor-agent-signer` and `praetor-soter-attester` (`tdx.small`, `--no-dev-os` for a production OS image, `--no-public-logs`), or updates a CVM of that name in place. It reads the secrets from `ENV_FILE` (default `.env`), deletes the env files it hands to `phala`, and keeps the rendered compose files and phala's answers in `.run/phala/`.
- **The registry, a choice for the human.** The repository is private, and a GHCR package pushed from it starts private. Either make the two packages public (package settings on GitHub): the images then publish the source tree, since `infra/node-service.Dockerfile` copies the whole build context (the tracked files minus `.dockerignore`: no `.env`, no keys, no docs). Or keep them private and add a classic token with `read:packages` only to the laptop's `.env` as `DSTACK_DOCKER_REGISTRY=ghcr.io`, `DSTACK_DOCKER_USERNAME=hliosone`, `DSTACK_DOCKER_PASSWORD=<token>` before `deploy` (GHCR takes classic tokens only). Those names enter `allowed_envs`, hence the compose hash: decide before registering the hashes (section 8).
- **Endpoints.** Phala's gateway serves the two ports at `https://<app-id>-3050.<gateway domain>` and `https://<app-id>-3060.<gateway domain>` and terminates TLS there (TLS inside the CVM stays open, tee-checklist item 6). Only `/health` answers without a caller HMAC; `/v1/info` needs one like every `/v1` route, so read the app id and compose hash with `phala cvms get` and check that each CVM runs a production (non-dev) OS image. These URLs become the server's `AGENT_SIGNER_URL` and `SOTER_ATTESTER_URL` (section 9).
- **Never delete and recreate agent-signer once accounts exist.** The CVM derives every agent key from its app id (`getKey`); a new CVM is a new app id, hence a new key for every account (below). Update in place: `deploy` again, same name.
- **OS image.** The CLI picks the default image (`dstack-0.6.1` on 2026-10-19); the services use the 0.5 SDK and were tested on the 0.5.3 simulator. If the socket calls fail, deploy with `PHALA_OS_IMAGE=dstack-0.5.12`.

Keys are derived inside the CVM (`getKey`), so the production agent keys differ from the simulator's: every existing account needs a new KYA and `SET_AGENT_KEY` for a key of the new TEE. The F10 rotation route (`POST /api/agent/rotate`) looks for the key Base holds among the TEE's key versions and finds none after a TEE change, so existing accounts would take the onboarding route instead (`POST /api/onboarding/agent/create`, then the mandate, the KYA and `SET_AGENT_KEY`). This path is read from the code and has **not been run** (neither the bank's KYA over an account that already has one from another TEE, nor a web app screen for it); check it in Phase C. Accounts created after the switch need nothing.

## 8. Register the compose hashes with the bank

1. Put the two compose hashes (`phala cvms get`, section 7; written with `0x`, comma-separated when several) in the bank's `ALLOWED_COMPOSE_HASHES_AGENT` and `ALLOWED_COMPOSE_HASHES_ATTESTER` and restart the bank. With `ATTESTATION_MODE=phala` the bank refuses to start without an agent allowlist.
2. Activate the attester: the bank issues a nonce (`POST /attesters/nonce`), the attester's quote is verified through Phala's verifier (`POST /attesters/verify`), and the bank signs the `AttesterAttestation` with the verified measurement (D33). It reaches Base through the transport.
3. **Re-register on every change**: any change to an image or to a CVM compose file changes the hash; list the new hash before the new CVM serves, activate the new attester, and have any one member deactivate the old one (tee-checklist item 4).

If Phala's verify API is unreachable or answers differently, [MANUAL.md](MANUAL.md) step 2 gives the fallback. The full checklist: [security/tee-checklist.md](security/tee-checklist.md).

## 9. Start the stack

**Rehearsal on the laptop (M18):**

```bash
make rehearsal     # PRAETOR_ENV=rehearsal make up PROD=1, then make e2e-smoke (F1, F5, F8), then scripts/deploy/prod-refusals.sh
```

`compose.prod.yml` adds a restart policy for every long-running service and log rotation for all, moves the scripted model to a `test` profile, passes `CADDY_TLS` to Caddy and disables the plain-HTTP tunnel site. `prod-refusals.sh` runs the bank, agent-signer, soter-attester, agent-runner and the api once each with `PRAETOR_ENV=prod` and their test-only settings (simulator attestations, the fake Tencent, the fake LLM), and expects each to refuse to start.

Passed on 2026-10-18 (D90): smoke F1, F5, F8 16 of 16 and the five prod refusals, after three fixes the rehearsal found (the scheduler never overlaps band checks, each refusal check runs without a network, the api refuses the fake Tencent before connecting to MySQL). The smoke used the scripted model (the local stack's fake-llm container was still up and `PRAETOR_ENV=rehearsal` allows it; in prod agent-runner refuses `FAKE_LLM_URL`). Not rehearsed: live Base, the Phala TEEs and a real certificate (Phase C).

**On the server (Phase C, Google Cloud).** Not run yet. In order, with `<ip>` the static IP, `app.<domain>` the host and `praetor` the deploy user. Steps 6 and 8 run on the laptop and can overlap steps 5 and 7.

1. **The VM** (Google Cloud console). Compute Engine, region `asia-east2`, `e2-standard-4`, boot disk Ubuntu 24.04 LTS x86/64 (not Minimal), 80 GB balanced persistent disk. Under networking, tick "Allow HTTP traffic" and "Allow HTTPS traffic" and reserve a static external IPv4. Under security, add the laptop's SSH public key (GCP names the user after the key's comment: `hliosone` below). In the VPC firewall rules, delete `default-allow-rdp` (and `default-allow-icmp` for 22, 80 and 443 only). Then point `app.<domain>` at the IP (A record, DNS only, TTL 300): Caddy asks for the certificate at its first start. With gcloud instead (not installed on the laptop; not run):

   ```bash
   gcloud compute addresses create praetor-ip --region asia-east2
   gcloud compute instances create praetor --zone asia-east2-a --machine-type e2-standard-4 \
     --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-size 80GB --boot-disk-type pd-balanced \
     --address praetor-ip --tags http-server,https-server
   gcloud compute firewall-rules create praetor-web --allow tcp:80,tcp:443 --target-tags http-server,https-server
   ```

2. **Bootstrap** (from the laptop; about 1.5 min in a container, not yet timed on a VM):

   ```bash
   scp scripts/deploy/server-bootstrap.sh hliosone@<ip>:
   ssh hliosone@<ip> sudo bash server-bootstrap.sh   # Docker, user praetor (with your SSH key), ufw, swap, Node, pnpm, cast
   ssh -t praetor@<ip> docker login                   # Docker Hub: about ten base images, anonymous pulls stop at 10 an hour
   ```

   It refuses a host route inside the stack's networks, and prints `UID_GID=<uid>:<gid>` when `praetor` could not get uid 1000 (the WeCross containers write `infra/wecross/generated` as that user): that line goes into `.env` at step 4.
3. **The repository** (private): a read-only deploy key, no submodules (the server builds no contract).

   ```bash
   ssh praetor@<ip> 'ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub' > /tmp/praetor-server.pub
   gh repo deploy-key add /tmp/praetor-server.pub -R hliosone/Praetor --title praetor-server
   ssh praetor@<ip> 'GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" git clone -q git@github.com:hliosone/Praetor.git ~/praetor'
   ```

   The key cannot push: the server's `fisco-live.json` comes back to the laptop by `scp` (step 12).
4. **`.env`** (mode 600). Copy from the laptop only what the server reuses, then add the production values and let `pnpm keys` generate the rest:

   ```bash
   grep -E '^(LIVE_[A-Z0-9_]+|SIGNER_HMAC_(MCP|API|BANK)|ATTESTER_HMAC_API|MP_APPID|MP_SECRET|PYTH_API_KEY|OPENCODE_API_KEY|OA_[A-Z_]+)=' .env \
     | ssh praetor@<ip> 'set -C; umask 077; cat > ~/praetor/.env'   # once: refuses to overwrite an existing .env
   ssh praetor@<ip>
   cd ~/praetor && cat >> .env <<'END'
   PRAETOR_ENV=prod
   CHAIN_MODE=live
   PUBLIC_HOST=app.<domain>
   PUBLIC_URL=https://app.<domain>
   CADDY_TLS=<ACME account email>
   ATTESTATION_MODE=phala
   SOTER_FAKE_TENCENT=0
   FAKE_LLM_URL=
   VAPID_SUBJECT=mailto:<an address the push services can reach>
   STANDING_ORDERS_INTERVAL_S=60
   AGENT_MAX_ACTIVE=4
   END
   make setup    # commit-msg hook, pnpm install --frozen-lockfile
   pnpm keys     # fills every missing secret (MySQL, sessions, internal tokens, staff enrolment tokens, VAPID, ...)
   ```

   - The `LIVE_` keys are the funded addresses and the hook's members (section 5): never regenerate them. From now on the laptop never runs `LIVE=1` (D97).
   - The four TEE HMACs come from the laptop because the CVMs, deployed from the laptop, must hold the same values; `pnpm keys` keeps them (it only fills missing values).
   - `CHAIN_MODE=live` must be in `.env` itself: `infra/fisco/gen.sh` reads only `.env` to pick the chain admin, else the `LOCAL_` bank key becomes admin and `deploy-fisco` fails.
   - Do not copy `infra/live.env`'s values into `.env`: `LIVE=1` adds that file after `.env`, and its values win.
   - The MySQL passwords must be final before MySQL's first start (its init script creates the users once).
   - `AGENT_MAX_ACTIVE=4`: one OpenCode instance takes 350 to 850 MB (Q35) on a 16 GB server that runs everything else.
   - Add `UID_GID` if step 2 printed it. `AGENT_SIGNER_URL`, `SOTER_ATTESTER_URL` and the two allowlists come at step 9.
5. **Images** (server, in tmux): `bash scripts/deploy/build-images.sh` fetches the FISCO binary, builds its image, pulls caddy and mysql and builds every image of the production profiles with make up's own compose command. A cold build on 4 CPUs took 4 min 35 s on the laptop for 17 of the 18 images (agent-runner not timed: its warm step stalled under the throwaway builder used for the timing); expect 5 to 10 minutes on the VM. Images are built where they run: `make up` passes `--build`, so images shipped from the laptop (1.87 GB as measured by `docker save`) would be rebuilt anyway, and they would come from the laptop's working tree, not the server's commit.
6. **TEE images** (laptop, during step 5): `PHALA_CONFIRM=1 REGISTRY=ghcr.io/hliosone scripts/deploy/phala-deploy.sh build` (section 7, after the registry choice). Check that the commit it prints is the server's `git rev-parse HEAD`.
7. **The FISCO chain and its consortium** (server). `make up` alone would start `wecross-setup` and `weid-deploy` before `deploy-fisco` opens the deploy whitelist (Q22), against a `fisco-live.json` that names the laptop's chain, so the base services and the consortium come first:

   ```bash
   export CHAIN_MODE=live FISCO_KEYSET=LIVE P="core chain mocks agent wecross"
   mkdir -p apps/web/dist infra/wecross/generated
   bash scripts/dev/compose-env.sh    # .run/compose.env: the LIVE wallet and FISCO keys
   bash infra/fisco/gen.sh            # 4 nodes, admin = the LIVE bank FISCO account
   make up-base PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"   # mysql, caddy (takes the certificate), fisco-node0..3
   make deploy-fisco ENV=live         # governance, then the consortium bound to base-sepolia.json: writes fisco-live.json
   ```

   `FISCO_KEYSET=LIVE` goes on every make call: `LIVE=1` alone exports `FISCO_KEYSET=LOCAL` (D75, a laptop choice).
8. **TEE CVMs** (laptop, once `PUBLIC_URL` is final): `PHALA_CONFIRM=1 PUBLIC_URL=https://app.<domain> scripts/deploy/phala-deploy.sh deploy`, then `phala cvms get` for each (section 7).
9. **Point the server at the TEEs** (server): append to `.env`

   ```bash
   AGENT_SIGNER_URL=https://<agent-signer app id>-3050.<gateway domain>
   SOTER_ATTESTER_URL=https://<soter-attester app id>-3060.<gateway domain>
   ALLOWED_COMPOSE_HASHES_AGENT=0x<agent-signer compose hash>
   ALLOWED_COMPOSE_HASHES_ATTESTER=0x<soter-attester compose hash>
   ```

   The bank refuses `ATTESTATION_MODE=phala` with an empty agent allowlist. Without working CVMs, the fallback is `PRAETOR_ENV=rehearsal`, `ATTESTATION_MODE=simulator`, no CVM URLs and `tee-sim` added to the profiles ([MANUAL.md](MANUAL.md) step 2): the simulator's key material is public, so the TEE claims do not hold on that server, and switching once accounts exist forces the untested re-KYA path of section 7. Decide before onboarding any account. If the CVMs are only late, steps 10 and 11 (C0, without the attester) may run first in that mode; switch before the first account or attester (`make down PROD=1 LIVE=1`, the Phala values in `.env`, step 10 again).
10. **The stack** (server): `make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"`, then `make ps PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"` (every service healthy; `weid-deploy` and `wecross-setup` exited 0). It keeps the chain, reuses the images of step 5, builds the web app, wires WeCross (`scripts/wecross/up.sh`) and starts the rest; `weid-deploy` compiles WeIdentity's Build-Tools with Gradle on its first run.
11. **Consortium bootstrap and prices** (server): `pnpm exec tsx scripts/evidence/live-run.ts --only C0` opens and relays the caps, the assets, the CN payout block and the demo sanction, sends a heartbeat, waits for the feeder's first Pyth prices and gives the new desk 4 USDC from the treasury; it prints `C0:` with the two Pyth prices, or `C0: stopped:` and the reason. Then activate the attester against the CVM:

    ```bash
    SOTER_ATTESTER_URL_HOST=https://<soter-attester app id>-3060.<gateway domain> \
      pnpm exec tsx -e "import('./scripts/demo/lib.ts').then(async (l) => console.log(await l.activateSoterAttester(l.stack())))"
    ```

    Approve the console devices: "Enrol this device" in the console at `https://app.<domain>` for each role, then `pnpm exec tsx scripts/demo/staff.ts <bank|regulator|operator> '<json from the console>'`. Never run `pnpm seed` or `scripts/demo/smoke-real-model.ts` on live: they fund at fork amounts and create owners from public labels.
12. **Accounts, phones, record.** Onboard on an iPhone at `https://app.<domain>` (MANUAL step 4), then fund the account after its KYA with `pnpm exec tsx scripts/deploy/fund-account.ts <account> 5 2 1` (at most 10 USDC, 6 and 3 USD of metals per call). The mini program: section 10. Run the smoke checks of section 11 (the automated suites stay off the server: they use the scripted model and fork amounts), copy `infra/deployments/fisco-live.json` back to the laptop (`scp praetor@<ip>:praetor/infra/deployments/fisco-live.json infra/deployments/`), commit it and fill the table of section 11.

**Open choices for the human** (before or during the day):

- GCP console or `gcloud` for step 1 (gcloud is not installed on the laptop).
- The domain and the ACME email (`app.<domain>` must resolve before step 7).
- The registry for the TEE images: public GHCR packages (they publish the source tree) or private ones with a `read:packages` token as encrypted env (section 7).
- A Docker Hub account for `docker login` on the server (anonymous pulls: 10 an hour per IP).
- Phala credit: about 43 hours of both CVMs today; the judging period needs about 2.8 USD a day.
- Phala, or the simulator fallback, before the first account (step 9).

## 10. Tunnels, phones and the mini program domain

- **Phones against a laptop stack** (local or `make up LIVE=1`): `make tunnel` starts a cloudflared quick tunnel (`--protocol http2 --edge-ip-version 4`, the Phase 0 flags) to Caddy over plain HTTP on the machine, writes its URL to `.run/tunnel-url` and points the mini program's develop environment at it; `make tunnel-stop` ends it. Each start gives a new address. `compose.prod.yml` disables the tunnel site, so it is never used with the production compose. Steps for testers: [TESTER.md](TESTER.md).
- **Passkeys are bound to the host** (WebAuthn rpId): for Face ID in a phone's browser against a laptop stack, set `PUBLIC_HOST` and `PUBLIC_URL` to the tunnel's address and run `make up` again; the automated suites then do not apply (they expect `praetor.localhost`). Passkeys created on `praetor.localhost` or a tunnel only work there: re-enrol on `app.<domain>` after deployment.
- **Mini program**: it runs on the team's phones in **debug mode** under the WeChat test account, so no domain allowlist applies. Point all three of its environments at the domain, since a DevTools Preview on a phone runs as `develop` (WeChat's development version): `for e in develop trial release; do node apps/miniprogram/scripts/set-api-base.mjs $e https://app.<domain>; done`. The Official Account callback URL moves to the domain too.

## 11. Smoke check and record

Spec 11 step 7 asks for `make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live`. The suites do not read `BASE_URL` yet: `scripts/demo/lib.ts` reaches the services on the Docker network (10.88.x), so its helpers run on the server itself (it takes the WebAuthn host from `PUBLIC_HOST` and `PUBLIC_URL`, D99), and `make e2e` ends with the 48 h warp test, which needs anvil. What exists: `make rehearsal` on a laptop and `make e2e-smoke` against a stack on the same machine. Against the deployed domain the check is manual until the suites reach the stack through the domain: [MANUAL.md](MANUAL.md) steps 4, 8 and 11 on `https://app.<domain>`, then a reachability check from mainland China cities (17CE). Never run `make e2e`, `make e2e-smoke` or `make e2e-live` against the server: they use the scripted model, which prod refuses, and fund at fork amounts. Read-only checks on the server (not run yet):

```bash
curl -s https://app.<domain>/api/health                                      # the api through Caddy
echo | openssl s_client -connect app.<domain>:443 -servername app.<domain> 2>/dev/null | openssl x509 -noout -issuer -dates
curl -sI https://app.<domain>/ | grep -i content-security-policy            # Caddy's headers served
make ps PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"
make logs PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross" S=bridge-relayer   # deliveries, no BadNonce
RPC=https://base-sepolia-rpc.publicnode.com; D=infra/deployments/base-sepolia.json
cast call $(jq -r .mandateHook $D) "statusOf(address)(uint8,uint8,uint8,uint64)" 0x0000000000000000000000000000000000000000 --rpc-url $RPC   # last value: heartbeat validity, in the future
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 "balanceOf(address)(uint256)" $(jq -r .paymaster $D) --rpc-url $RPC   # the paymaster's deposit left
bash scripts/deploy/prod-refusals.sh                                         # 5 x ok
```

Record below what was deployed (no secrets):

| Item | Value |
|---|---|
| Date, commit | Phase C |
| Domain, server | Phase C |
| Base deployment | `infra/deployments/base-sepolia.json`: MandateHook `0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`, block 48301428, deployed 2026-10-19 from the laptop's `LIVE_` keys for the server (section 5, D101); the M16 deployment (MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`, block 48253270, 2026-10-18) kept in `base-sepolia-m16.json` |
| FISCO deployment | `infra/deployments/fisco-live.json`: today on the laptop's local chain (D75), bound to the M16 hook; Phase C: the server's chain, bound to the new hook |
| agent-signer CVM: app id, compose hash | Phase C |
| soter-attester CVM: app id, compose hash | Phase C |
| Commands run | Phase C |
