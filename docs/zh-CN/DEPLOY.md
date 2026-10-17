英文版：[DEPLOY.md](../DEPLOY.md)

# 部署 Praetor

> **2026-10-18 时的状态。** Base 合约已用这台笔记本电脑的 `LIVE_` 密钥部署到 Base Sepolia（MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`，`infra/deployments/base-sepolia.json`），其联盟部署在笔记本电脑的本地 FISCO 链上（实链模式，D74、D75）。生产 compose 覆盖文件、演练目标和生产拒绝检查均已存在（M18；演练关卡在 `docs/PROGRESS.md` 中尚待完成）。云端部署是 **Phase C 的一个步骤，由人工参与完成**（spec 10），目前尚未进行；spec 11 中的服务器初始化脚本（`scripts/deploy/server-bootstrap.sh`）尚不存在。本文档给出已经存在的命令，明确说明 Makefile 在哪些地方尚未与 spec 11 一致，Phase C 也在此记录所使用的值（绝不记录任何密钥）。中文版由英文版翻译，以英文版为准。

## 1. 环境

笔记本电脑和服务器运行相同的镜像和相同的 compose 文件；只有 `.env` 和一个覆盖文件不同（spec 11）。

| 模式 | 启动方式 | `PRAETOR_ENV` | Base | FISCO | TEE | 公开 URL |
|---|---|---|---|---|---|---|
| 本地 | `make up`（`infra/compose.yml`） | `local` | Base Sepolia 的 anvil 分叉（`CHAIN_MODE=fork`，`LOCAL_` 密钥） | Docker 中的 4 个节点 | dstack 模拟器（`ATTESTATION_MODE=simulator`） | `https://praetor.localhost`（Caddy 内部 CA） |
| 本地实链 | `make up LIVE=1`（加入 `infra/live.env`） | `local`（`LIVE=1` 不改变它） | Base Sepolia（`CHAIN_MODE=live`，`LIVE_` 密钥，不启动 anvil） | 同一条本地链，由 `LOCAL` 密钥集治理（`FISCO_KEYSET=LOCAL`，D75） | 模拟器 | 同上，另加供手机使用的 `make tunnel` |
| 演练 | `make rehearsal`（`compose.yml` + `compose.prod.yml`） | `rehearsal` | 取自 `.env` 的 `CHAIN_MODE`：除非 `.env` 设置了实链值，否则为分叉（该目标不传 `LIVE=1`） | 同上 | 模拟器（生产拒绝规则单独检查） | `https://praetor.localhost` |
| 生产 | 服务器，`compose.yml` + `compose.prod.yml`（第 9 节） | `prod` | Base Sepolia | 服务器自己的 4 个节点 | Phala Cloud CVM（`ATTESTATION_MODE=phala`） | `https://app.<domain>` |

只有 `PRAETOR_ENV=prod` 会触发生产环境的拒绝规则，因此演练仍可以在模拟器上启动。

## 2. 生产环境拓扑

- **一台服务器**（spec 00：腾讯云轻量应用服务器香港，4 vCPU，16 GB，Ubuntu LTS）：Docker，防火墙只开放 22、80 和 443，一个非 root 的部署用户，自动安全更新。服务器运行 Caddy（通过 `CADDY_TLS` 为 `app.<domain>` 获取 ACME 证书，仅 DNS，不使用 CDN 代理）、MySQL、api、mcp、agent-runner（每个活跃用户一个 OpenCode 实例）、scheduler、bundler、notifier、oracle-feeder、三个成员服务、bridge-relayer、WeCross 路由器和账户管理器、四个 FISCO 节点、WeIdentity 以及各个模拟服务。
- **两台 Phala Cloud CVM**（`tdx.small`，带 dstack 的 Intel TDX）：`agent-signer` 和 `soter-attester`，两个独立的度量值。
- **外部服务**：Base Sepolia RPC、大模型（OpenCode Zen，DeepSeek）、Pyth Hermes、腾讯的微信 API、浏览器的推送服务。

## 3. 配置与密钥

- `.env` 保存所有密钥和机密，权限 600，被 git 忽略。`pnpm keys` 只填充缺失的值（三套钱包密钥、共享机密、用于 Web 推送的 VAPID 密钥对），并且只打印公开地址。spec 11 要求生产密钥**在服务器上生成**；第 5 节说明为何复用现有的 Base 部署需要把笔记本电脑的 `LIVE_` 成员密钥放到服务器上。
- 密钥集（D1）：`.env` 为每个钱包密钥保存 `LOCAL_*`、`LIVE_*` 和 `SANDBOX_*` 三份。`make up` 会写入 `.run/compose.env`，以不带前缀的名称保存当前密钥集（`CHAIN_MODE=live` 时为 `LIVE`，否则为 `LOCAL`）；设置了 `FISCO_KEYSET` 时，FISCO 侧的密钥取自它（D75）。
- EIP-712 域名必须与部署一致：live Base Sepolia 使用 `DOMAIN_NAME=Praetor`，评委自己的沙盒部署使用 `Praetor-sandbox`（尚未构建；临时的 `/sandbox` 页面运行在主部署上，其水龙头在线上 Base 拒绝工作）。
- 与 `infra/.env.example` 不同的生产值：

| 变量 | 生产值 |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `PUBLIC_HOST`、`PUBLIC_URL` | `app.<domain>`、`https://app.<domain>`（passkey 绑定到这个主机名） |
| `CADDY_TLS` | ACME 账户邮箱（`compose.prod.yml` 把它传给 Caddy；默认为 `internal`） |
| `CHAIN_MODE`、`BASE_RPC_URL` | `live`，一个 Base Sepolia RPC |
| `DEPLOYMENTS_FILE`、`FISCO_DEPLOYMENTS_FILE` | `infra/deployments/base-sepolia.json`、`infra/deployments/fisco-live.json` |
| `DOMAIN_NAME` | `Praetor` |
| `ATTESTATION_MODE` | `phala` |
| `AGENT_SIGNER_URL`、`SOTER_ATTESTER_URL` | 两台 CVM（第 7 节） |
| `ALLOWED_COMPOSE_HASHES_AGENT`、`ALLOWED_COMPOSE_HASHES_ATTESTER` | 两台 CVM 的 compose 哈希（第 8 节） |
| `SOTER_FAKE_TENCENT`、`WECHAT_API_BASE` | `0`、`https://api.weixin.qq.com` |
| `MP_APPID`、`MP_SECRET`、`OA_*` | 人工提供的微信配置值（api 和 soter-attester 都使用 `MP_*`） |
| `VAPID_SUBJECT` | 推送服务可以联系到的 `mailto:` 地址 |
| `FAKE_LLM_URL` | 留空（agent-runner 在 prod 中拒绝该值；`compose.prod.yml` 从不启动脚本化模型） |
| `PRICE_CHECK_INTERVAL_S`、`HEARTBEAT_INTERVAL_S`、`HEARTBEAT_TTL_S` | `900`、`300`、`900` |
| `STANDING_ORDERS_INTERVAL_S`、`AUDIT_FROM`、`ANCHOR_INTERVAL_S` | `60`、`deploy`、`3600` |
| `BRIDGE`、`BRIDGE_WATCHDOG_S` | `wecross`、`120` |
| `DEMO_SCALE` | 在 live Base Sepolia 上为 `100`（Q30） |
| MySQL 和 OpenCode 密码 | 自动生成（prod 拒绝默认密码） |

目前 `PRAETOR_ENV=prod` 会拒绝：模拟器证明（agent-signer、soter-attester、bank，以及加载 `packages/config` 的服务）；伪造的腾讯接口以及任何其他微信 API 地址（soter-attester 和 api）；分叉链、默认密码以及未限流的沙盒（`packages/config`：bundler、bridge-relayer、成员服务）；伪造的大模型（agent-runner）。`scripts/deploy/prod-refusals.sh` 在生产 compose 中检查其中五个服务。[安全自评](SELF_ASSESSMENT.md)列出了其中的缺口（已知风险 25）。

## 4. 为 LIVE 地址充值

实链预算有意保持很小（D74）：由人工为部署者充值，而 Base Sepolia 的 gas 价格（测量时约 0.006 gwei）使运行成本很低。实链运行按部署者 0.0133 ETH、treasury 44 USDC 的预算规划。

```bash
pnpm exec tsx scripts/deploy/fund-live.ts           # 试运行：每个需要 gas 的 LIVE 账户还缺多少
pnpm exec tsx scripts/deploy/fund-live.ts --send    # 从 LIVE 部署者实际发送
```

该脚本拒绝 84532 之外的任何链，在部署者上保留 0.006 ETH（用于部署及其 paymaster 押金），并把 bundler 补足到 0.003 ETH，把 WeCross 的 Base 账户、oracle feeder 和 desk operator 各补足到 0.001，把 payout partner 和 treasury 补足到 0.0005；它只打印地址和金额。它只转移 ETH：treasury 的 USDC 来自 Circle 水龙头（每两小时 20 USDC）。联盟链成员的签名密钥和所有 FISCO 密钥都不需要 ETH，用户也从不持有 ETH：由 paymaster 赞助他们的操作。`SANDBOX_` 密钥集只在独立的沙盒部署中需要，而它尚未构建。

## 5. 部署 Base 合约

```bash
DRY_RUN=1 make deploy-contracts ENV=base-sepolia                          # 模拟：估算 gas 和费用，不发送任何交易
PAYMASTER_DEPOSIT_WEI=4000000000000000 make deploy-contracts ENV=base-sepolia
```

`scripts/deploy/contracts.sh` 将 `LIVE_` 密钥映射为 `contracts/base/script/Deploy.s.sol` 读取的名称（不打印任何值），以域名 `Praetor` 部署所有合约，最后把 hook 与其模块连接起来，充入 paymaster 押金（live 上默认 0.02 ETH；上面的命令为 0.004 ETH，约可赞助 1,600 次操作），并写入 `infra/deployments/base-sepolia.json`。RPC 为 `BASE_LIVE_RPC_URL`（默认 `https://sepolia.base.org`）。`make deploy-contracts ENV=sandbox` 使用 `SANDBOX_` 密钥和域名 `Praetor-sandbox` 部署。

**现有部署。** 2026-10-18，这一流程在 Base Sepolia 的区块 48253270 部署了 Praetor，总共约花费 0.0045 ETH。hook 的三个成员地址是不可更改的构造函数参数（bank `0x9D45C4755CD26acAf3DAb12fE2c1B42AAdd1d52e`、regulator `0x5faaf3F8CC672A5357E648C9dfD81cD84d21e4e0`、operator `0x353046676e122D8eCb6F474A3aA57DBb338A525f`），因此 Phase C 开始前要在两条路径中二选一：

- **复用它**：服务器持有笔记本电脑的 `LIVE_` 成员 Base 签名密钥（以及 Base 信任的其他 `LIVE_` 密钥），这偏离了 spec 11 的“在服务器上生成生产密钥”；或者
- **重新部署**：服务器用 `pnpm keys` 生成自己的密钥，由人工为其部署者充值，然后在服务器上重新执行第 4 和第 5 节。

`SOTER_COUNTER_STRICT` 是 hook 的构造函数参数（默认 true）；如果 Phase C 发现 iOS 上 SOTER 计数器不递增，就需要用 `SOTER_COUNTER_STRICT=0` 重新部署（已知风险 16）。

## 6. 部署 FISCO 联盟链

```bash
make deploy-fisco ENV=live               # 写入 infra/deployments/fisco-live.json，绑定到 base-sepolia.json
```

`scripts/fisco/deploy.ts` 先一次性初始化 FISCO 治理（regulator 和 operator 作为治理委员，权重 51/51，然后设置部署白名单：部署者、WeIdentity 管理员、WeCross 的 FISCO 账户，Q22），再部署成员注册表、各个提案板（board）、审计日志和 outbox，并绑定到同一环境的 Base 部署（hook 地址和域名）。它通过 `FISCO_RPC_URL_HOST` 访问 FISCO（默认 `http://10.88.1.10:8545`，即 Docker 网络上的 node0），因此要在链启动后于链所在的机器上运行。FISCO 侧的密钥取自 `FISCO_KEYSET`，否则取自该环境的密钥集：在笔记本电脑上，实链联盟是用 `LOCAL` FISCO 账户部署在本地链上的（D75），因此目前的 `fisco-live.json` 指向笔记本电脑的链；服务器自己的链需要用其 `LIVE_` FISCO 密钥再次运行该命令。WeIdentity 的合约由 compose 文件中的 `weid-deploy` 任务部署，WeCross 的 hub 和 proxy 由 `wecross-setup` 部署。

## 7. Phala Cloud 上的 TEE

对 `agent-signer` 和 `soter-attester` 分别执行：

1. 从代码仓库构建镜像并推送到镜像仓库；在 CVM 的 compose 文件中**按 digest** 引用它（tee-checklist 第 2 项）。
2. 使用 Phala Cloud CLI（`phala`，Phase 0 中锁定的 1.1.22 版本）或控制台部署 CVM，设置 `PRAETOR_ENV=prod`、`ATTESTATION_MODE=phala`，并将机密作为**加密环境变量**传入：agent-signer 为 `SIGNER_HMAC_MCP`、`SIGNER_HMAC_API`、`SIGNER_HMAC_BANK`；soter-attester 为 `ATTESTER_HMAC_API`、`MP_APPID`、`MP_SECRET`，另加用于读取域名和 hook 地址的部署文件。实际执行的命令在运行时记录在第 11 节。
3. 从控制台（或服务的 `/v1/info`）读取 CVM 的 app id 和 compose 哈希，并确认它是生产（非调试）CVM。
4. 将服务器上的 `AGENT_SIGNER_URL` 和 `SOTER_ATTESTER_URL` 指向这两台 CVM（CVM 内部的 TLS 是检查清单的未完成项，第 6 项）。

密钥在 CVM 内部派生（`getKey`），因此生产环境的智能体密钥与模拟器派生的不同：每个现有账户都需要为新 TEE 中的密钥重新获得 KYA 并执行 `SET_AGENT_KEY`。F10 的轮换接口（`POST /api/agent/rotate`）会在 TEE 的各个密钥版本中查找 Base 上持有的那把密钥，更换 TEE 之后将找不到，因此现有账户需改走开户接口（`POST /api/onboarding/agent/create`，然后是授权、KYA 和 `SET_AGENT_KEY`）。这条路径是从代码中推断出来的，**尚未运行过**（既未验证银行能否为已持有另一 TEE 所签 KYA 的账户签发新的 KYA，也没有对应的 Web 应用界面）；需在 Phase C 中验证。切换之后创建的账户无需任何操作。

## 8. 向银行登记 compose 哈希

1. 把两个 compose 哈希分别写入银行的 `ALLOWED_COMPOSE_HASHES_AGENT` 和 `ALLOWED_COMPOSE_HASHES_ATTESTER`，然后重启 bank。在 `ATTESTATION_MODE=phala` 下，没有智能体白名单时 bank 拒绝启动。
2. 激活 attester：银行签发一个 nonce（`POST /attesters/nonce`），attester 的 quote 通过 Phala 的验证服务校验（`POST /attesters/verify`），然后银行用经过验证的度量值签署 `AttesterAttestation`（D33）。它经由传输层到达 Base。
3. **每次变更都要重新登记**：镜像或 CVM compose 文件的任何变更都会改变哈希；在新 CVM 提供服务之前登记新哈希，激活新的 attester，并由任意一个成员停用旧的 attester（tee-checklist 第 4 项）。

如果 Phala 的验证 API 无法访问或返回格式不同，[MANUAL.md](../MANUAL.md) 第 2 步给出了备选方案。完整检查清单：[security/tee-checklist.md](../security/tee-checklist.md)。

## 9. 启动整套服务

**在笔记本电脑上演练（M18）：**

```bash
make rehearsal     # PRAETOR_ENV=rehearsal make up PROD=1，然后 make e2e-smoke（F1、F5、F8），然后 scripts/deploy/prod-refusals.sh
```

`compose.prod.yml` 为每个长期运行的服务加上重启策略、为所有服务加上日志轮转，把脚本化模型移到 `test` profile，把 `CADDY_TLS` 传给 Caddy，并停用明文 HTTP 的隧道站点。`prod-refusals.sh` 以 `PRAETOR_ENV=prod` 及各自的仅测试设置（模拟器证明、伪造的腾讯接口、伪 LLM）分别运行一次 bank、agent-signer、soter-attester、agent-runner 和 api，并期望每个服务都拒绝启动。

**在服务器上（Phase C）。** 目前还没有服务器专用的目标：

```bash
git clone --recurse-submodules <repository> praetor && cd praetor
make setup                     # commit-msg 钩子，pnpm install --frozen-lockfile
pnpm keys                      # 将服务器的密钥生成到 .env（权限 600）；若复用部署，则使用第 5 节所述的 LIVE_ 密钥
# 将人工提供的值和第 3 节的生产值填入 .env（CHAIN_MODE=live、CADDY_TLS、PUBLIC_HOST 等）
```

Makefile 目前的行为，以及最接近的命令：

- `make up PROD=1` 会加入 `compose.prod.yml`，但不加 `LIVE=1` 时仍会启动 anvil（`up-base` 和默认的 `dev` profile），并且默认 profile 包含 `tee-sim`（TEE 模拟器）。
- `LIVE=1` 去掉了 anvil 和 `dev` profile，但会导出 `FISCO_KEYSET=LOCAL`（D75，这是针对笔记本电脑的选择），并加入 `infra/live.env`，其中的值会覆盖 `.env`。
- 在服务器专用目标出现之前，最接近的命令如下。它**尚未运行过**，需在 Phase C 中验证：

```bash
make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"
make deploy-fisco ENV=live     # 服务器自己的链（第 6 节）
make down && make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"   # 让各服务重新读取 fisco-live.json
```

然后登记 TEE（第 7 和第 8 节），并为账户开户。

## 10. 隧道、手机和小程序域名

- **手机连接笔记本电脑上的栈**（本地或 `make up LIVE=1`）：`make tunnel` 启动一个 cloudflared 快速隧道（`--protocol http2 --edge-ip-version 4`，即 Phase 0 中验证过的参数），通过本机的明文 HTTP 连接 Caddy，把 URL 写入 `.run/tunnel-url`，并把小程序的 develop 环境指向它；`make tunnel-stop` 结束隧道。每次启动都会得到新地址。`compose.prod.yml` 停用了隧道站点，因此生产 compose 从不使用它。测试人员的步骤：[TESTER.md](../TESTER.md)。
- **Passkey 绑定主机名**（WebAuthn rpId）：若要在手机浏览器中对笔记本电脑上的栈使用 Face ID，需把 `PUBLIC_HOST` 和 `PUBLIC_URL` 设为隧道地址并再次运行 `make up`；此时自动化测试套件不适用（它们要求 `praetor.localhost`）。在 `praetor.localhost` 或隧道上创建的 passkey 只能在那里使用；部署后需要在 `app.<domain>` 上重新注册。
- **小程序**：它以**调试模式**运行在团队手机上的微信测试账号中，因此不受域名白名单限制。用 `node apps/miniprogram/scripts/set-api-base.mjs release https://app.<domain>` 把其 release 环境指向域名；公众号回调 URL 也改为该域名。

## 11. 冒烟检查与记录

spec 11 第 7 步要求运行 `make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live`。测试套件目前并不读取 `BASE_URL`：`scripts/demo/lib.ts` 把 origin 固定为 `https://praetor.localhost`，并通过 Docker 网络（10.88.x）访问各服务，而且 `make e2e` 最后运行需要 anvil 的 48 小时 warp 测试。目前存在的是：笔记本电脑上的 `make rehearsal`，以及针对同一台机器上运行的栈的 `make e2e-smoke`。在测试套件能从环境读取主机名之前，针对已部署域名的检查需要人工完成：在 `https://app.<domain>` 上执行 [MANUAL.md](../MANUAL.md) 的第 4、8 和 11 步，然后从中国大陆多个城市进行可达性检查（17CE）。

在下表记录所部署的内容（不含任何密钥）：

| 项目 | 值 |
|---|---|
| 日期、commit | Phase C |
| 域名、服务器 | Phase C |
| Base 部署 | `infra/deployments/base-sepolia.json`：MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`，区块 48253270，2026-10-18 用笔记本电脑的 `LIVE_` 密钥部署；Phase C：复用或重新部署（第 5 节） |
| FISCO 部署 | `infra/deployments/fisco-live.json`：目前位于笔记本电脑的本地链上（D75）；Phase C：服务器自己的链 |
| agent-signer CVM：app id、compose 哈希 | Phase C |
| soter-attester CVM：app id、compose 哈希 | Phase C |
| 执行的命令 | Phase C |
