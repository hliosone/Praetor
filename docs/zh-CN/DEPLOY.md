英文版：[DEPLOY.md](../DEPLOY.md)

# 部署 Praetor

> **M17 时的状态。** 云端部署是 **Phase C 的一个步骤，由人工参与完成**（spec 10），目前尚未进行。生产环境的 compose 覆盖文件（`infra/compose.prod.yml`）和部署演练由负责人在 **M18 中构建**；spec 11 中的服务器初始化脚本（`scripts/deploy/server-bootstrap.sh`）尚不存在。本文档给出部署计划和目前已经存在的命令，Phase C 也在此记录所使用的值（绝不记录任何密钥）。中文版由英文版翻译，以英文版为准。

## 1. 环境

笔记本电脑和服务器运行相同的镜像和相同的 compose 文件；只有 `.env` 和一个覆盖文件不同（spec 11）。

| `PRAETOR_ENV` | 运行位置 | Base | FISCO | TEE | 公开 URL |
|---|---|---|---|---|---|
| `local` | 笔记本电脑，`infra/compose.yml` | Base Sepolia 的 anvil 分叉（`CHAIN_MODE=fork`） | Docker 中的 4 个节点 | dstack 模拟器（`ATTESTATION_MODE=simulator`） | `https://praetor.localhost`（Caddy 内部 CA） |
| `local-live` | 笔记本电脑 | Base Sepolia（`CHAIN_MODE=live`） | 同上 | 模拟器 | 同上，另加供手机使用的隧道 |
| `rehearsal` | 笔记本电脑，`compose.yml` + `compose.prod.yml`（M18） | live | 同上 | 模拟器（生产拒绝规则单独测试） | `https://praetor.localhost` |
| `prod` | 服务器，`compose.yml` + `compose.prod.yml`（M18） | live | 同上，运行在服务器上 | Phala Cloud CVM（`ATTESTATION_MODE=phala`） | `https://app.<domain>` |

只有 `PRAETOR_ENV=prod` 会触发生产环境的拒绝规则，因此演练仍可以在模拟器上启动。

## 2. 生产环境拓扑

- **一台服务器**（spec 00：腾讯云轻量应用服务器香港，4 vCPU，16 GB，Ubuntu LTS）：Docker，防火墙只开放 22、80 和 443，一个非 root 的部署用户，自动安全更新。服务器运行 Caddy（为 `app.<domain>` 使用 Let's Encrypt，仅 DNS，不使用 CDN 代理）、MySQL、api、mcp、agent-runner（每个活跃用户一个 OpenCode 实例）、scheduler、bundler、notifier、oracle-feeder、三个成员服务、bridge-relayer、WeCross 路由器和账户管理器、四个 FISCO 节点、WeIdentity 以及各个模拟服务。
- **两台 Phala Cloud CVM**（`tdx.small`，带 dstack 的 Intel TDX）：`agent-signer` 和 `soter-attester`，两个独立的度量值。
- **外部服务**：Base Sepolia RPC、大模型（OpenCode Zen，DeepSeek）、Pyth Hermes、腾讯的微信 API。

## 3. 配置与密钥

- `.env` 保存所有密钥和机密，权限 600，被 git 忽略。生产密钥用 `pnpm keys` **在服务器上生成**，绝不从笔记本电脑复制。生成器只填充缺失的值，并且只打印公开地址。
- 密钥集（D1）：`.env` 为每个钱包密钥保存 `LOCAL_*`、`LIVE_*` 和 `SANDBOX_*` 三份。服务先读取**不带前缀**的名称，再读取当前密钥集的前缀（`CHAIN_MODE=live` 时为 `LIVE`，否则为 `LOCAL`，或由 `KEY_SET` 指定的密钥集）。在生产服务器上，要么填写不带前缀的名称，要么使用 `LIVE_` 密钥集运行。
- EIP-712 域名必须与部署一致：live Base Sepolia 使用 `DOMAIN_NAME=Praetor`，评委沙盒使用 `Praetor-sandbox`。
- 与 `infra/.env.example` 不同的生产值：

| 变量 | 生产值 |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `CHAIN_MODE`、`BASE_RPC_URL` | `live`，一个 Base Sepolia RPC |
| `DEPLOYMENTS_FILE`、`FISCO_DEPLOYMENTS_FILE` | `infra/deployments/base-sepolia.json`、`infra/deployments/fisco-live.json` |
| `DOMAIN_NAME` | `Praetor` |
| `ATTESTATION_MODE` | `phala` |
| `ALLOWED_COMPOSE_HASHES_AGENT`、`ALLOWED_COMPOSE_HASHES_ATTESTER` | 两台 CVM 的 compose 哈希（第 7 节） |
| `SOTER_FAKE_TENCENT`、`WECHAT_API_BASE` | `0`、`https://api.weixin.qq.com` |
| `MP_APPID`、`MP_SECRET`、`OA_*` | 人工提供的微信配置值（Phase A） |
| `FAKE_LLM_URL` | 留空（agent-runner 在 prod 中拒绝该值） |
| `PRICE_CHECK_INTERVAL_S`、`HEARTBEAT_INTERVAL_S`、`HEARTBEAT_TTL_S` | `900`、`300`、`900` |
| `STANDING_ORDERS_INTERVAL_S`、`AUDIT_FROM`、`ANCHOR_INTERVAL_S` | `60`、`deploy`、`3600` |
| `BRIDGE`、`BRIDGE_WATCHDOG_S` | `wecross`、`120` |
| `DEMO_SCALE` | 在 live Base Sepolia 上为 `100`（Q30） |
| MySQL 和 OpenCode 密码 | 自动生成（prod 拒绝默认密码） |

目前 `PRAETOR_ENV=prod` 会拒绝：模拟器证明（agent-signer、soter-attester、bank，以及使用 `packages/config` 的服务）；伪造的腾讯接口以及任何其他微信 API 地址（soter-attester）；分叉链、默认密码以及未限流的沙盒（`packages/config`：bundler、bridge-relayer、成员服务）；伪造的大模型（agent-runner）。[安全自评](SELF_ASSESSMENT.md)列出了其中的缺口（已知风险 25）。

## 4. 为 LIVE 地址充值

[QUESTIONS.md 的 "Funding" 一节](../QUESTIONS.md#funding-before-go)列出了每个 LIVE 地址、金额及用途：在 Base Sepolia 上共约 **0.091 ETH 和 100 USDC**，用于部署者（合约和 paymaster 押金）、bundler、WeCross 的 Base 账户、oracle feeder、desk operator、payout partner 和 treasury（USDC 来自 Circle 水龙头，每两小时 20 USDC）。联盟链成员的签名密钥和所有 FISCO 密钥都不需要 ETH。用户从不持有 ETH：由 paymaster 赞助他们的操作。SANDBOX 密钥集（约 0.086 ETH，使用自己的 "pUSD"）只在评委沙盒中需要。截至 M17，尚无任何 LIVE 地址获得充值（[BLOCKERS.md](../BLOCKERS.md)，B1）。

## 5. 部署 Base 合约

```bash
make deploy-contracts ENV=base-sepolia   # LIVE_ 密钥，域名 "Praetor"，写入 infra/deployments/base-sepolia.json
make deploy-contracts ENV=sandbox        # SANDBOX_ 密钥，域名 "Praetor-sandbox"，写入 infra/deployments/sandbox.json
```

`scripts/deploy/contracts.sh` 将该密钥集的密钥映射为 `contracts/base/script/Deploy.s.sol` 读取的名称（不打印任何值），部署所有合约，最后把 hook 与其模块连接起来，并充入 paymaster 押金（live 上为 0.02 ETH）。RPC 为 `BASE_LIVE_RPC_URL`（默认 `https://sepolia.base.org`）。`SOTER_COUNTER_STRICT` 是 hook 的构造函数参数（默认 true）；如果 Phase C 发现 iOS 上 SOTER 计数器不递增，必须在此步骤之前设置它（已知风险 16）。也可以复用 M16 的 live 部署，而不重新部署，但有一个约束：hook 的三个成员地址不可更改（构造函数参数），因此复用某个部署意味着服务器持有部署它时使用的成员密钥。自行生成密钥的服务器（spec 11）需要自己的部署和自己的充值；请在 Phase C 开始前二选一。

## 6. 部署 FISCO 联盟链

```bash
make deploy-fisco ENV=live               # 写入 infra/deployments/fisco-live.json，绑定到 base-sepolia.json
```

`scripts/fisco/deploy.ts` 先一次性初始化 FISCO 治理（regulator 和 operator 作为治理委员，权重 51/51，然后设置部署白名单：部署者、WeIdentity 管理员、WeCross 的 FISCO 账户，Q22），再部署成员注册表、各个提案板（board）、审计日志和 outbox，并绑定到同一环境的 Base 部署（hook 地址和域名）。它通过 `FISCO_RPC_URL_HOST` 访问 FISCO（默认 `http://10.88.1.10:8545`，即 Docker 网络上的 node0），因此要在链启动后于服务器上运行。WeIdentity 的合约由 compose 文件中的 `weid-deploy` 任务部署，WeCross 的 hub 和 proxy 由 `wecross-setup` 部署。

## 7. Phala Cloud 上的 TEE

对 `agent-signer` 和 `soter-attester` 分别执行：

1. 从代码仓库构建镜像并推送到镜像仓库；在 CVM 的 compose 文件中**按 digest** 引用它（tee-checklist 第 2 项）。
2. 使用 Phala Cloud CLI（`phala`，Phase 0 中锁定的 1.1.22 版本）或控制台部署 CVM，设置 `PRAETOR_ENV=prod`、`ATTESTATION_MODE=phala`，并将机密作为**加密环境变量**传入：agent-signer 为 `SIGNER_HMAC_MCP`、`SIGNER_HMAC_API`、`SIGNER_HMAC_BANK`；soter-attester 为 `ATTESTER_HMAC_API`、`MP_APPID`、`MP_SECRET`，另加用于读取域名和 hook 地址的部署文件。实际执行的命令在运行时记录在第 11 节。
3. 从控制台（或服务的 `/v1/info`）读取 CVM 的 app id 和 compose 哈希，并确认它是生产（非调试）CVM。
4. 将服务器上的 `AGENT_SIGNER_URL` 和 `SOTER_ATTESTER_URL` 指向这两台 CVM（CVM 内部的 TLS 是检查清单的未完成项，第 6 项）。

密钥在 CVM 内部派生（`getKey`），因此生产环境的智能体密钥与模拟器派生的不同：每个账户都需要为其生产智能体密钥重新获得 KYA 并执行 `SET_AGENT_KEY`（流程 F10，在 M15 中构建）。

## 8. 向银行登记 compose 哈希

1. 把两个 compose 哈希分别写入银行的 `ALLOWED_COMPOSE_HASHES_AGENT` 和 `ALLOWED_COMPOSE_HASHES_ATTESTER`，然后重启 bank。在 `ATTESTATION_MODE=phala` 下，没有智能体白名单时 bank 拒绝启动。
2. 激活 attester：银行签发一个 nonce（`POST /attesters/nonce`），attester 的 quote 通过 Phala 的验证服务校验（`POST /attesters/verify`），然后银行用经过验证的度量值签署 `AttesterAttestation`（D33）。它经由传输层到达 Base。
3. **每次变更都要重新登记**：镜像或 CVM compose 文件的任何变更都会改变哈希；在新 CVM 提供服务之前登记新哈希，激活新的 attester，并由任意一个成员停用旧的 attester（tee-checklist 第 4 项）。

如果 Phala 的验证 API 无法访问或返回格式不同，[MANUAL.md](../MANUAL.md) 第 2 步给出了备选方案。完整检查清单：[security/tee-checklist.md](../security/tee-checklist.md)。

## 9. 在服务器上启动整套服务

```bash
git clone --recurse-submodules <repository> praetor && cd praetor
make setup                     # commit-msg 钩子，pnpm install --frozen-lockfile
pnpm keys                      # 将服务器的密钥生成到 .env（权限 600），只打印公开地址
# 将人工提供的值和第 3 节的生产值填入 .env
make up                        # 目前：仅 compose.yml；生产覆盖（使用 Let's Encrypt 的 Caddy、重启
                               # 策略、不含 anvil、live Base）随 M18 中的 infra/compose.prod.yml 提供
```

然后，如果尚未部署，部署合约（第 5 和第 6 节），登记 TEE（第 7 和第 8 节），并初始化或开通账户。

## 10. 隧道、手机和小程序域名

- **手机连接本地服务**：spec 11 中的 `make tunnel`（cloudflared，参数 `--protocol http2 --edge-ip-version 4`，URL 写入 `.run/tunnel-url`）目前仍是一个以错误退出的占位实现；在它完成之前，请在 Caddy 前手动运行 cloudflared。
- **小程序**（在 M14 中构建）：它以**调试模式**运行在团队手机上的微信测试账号中，因此不受域名白名单限制；它的 `config.js` 和公众号回调 URL 指向公开主机（先是隧道 URL，之后是 `app.<domain>`）。
- **Passkey 绑定域名**（WebAuthn rpId）：在 `praetor.localhost` 或隧道上创建的 passkey 只能在那里使用；部署后需要在正式域名上重新注册。

## 11. 冒烟检查与记录

```bash
make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live    # 针对部署环境的冒烟测试子集
```

然后从中国大陆多个城市进行可达性检查（17CE）。在下表记录所部署的内容（不含任何密钥）：

| 项目 | 值 |
|---|---|
| 日期、commit | Phase C |
| 域名、服务器 | Phase C |
| Base 部署 | `infra/deployments/base-sepolia.json`（Phase C） |
| FISCO 部署 | `infra/deployments/fisco-live.json`（Phase C） |
| agent-signer CVM：app id、compose 哈希 | Phase C |
| soter-attester CVM：app id、compose 哈希 | Phase C |
| 执行的命令 | Phase C |
