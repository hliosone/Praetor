英文版：[DEPLOY.md](../DEPLOY.md)

# 部署 Praetor

> **2026-10-18 时的状态。** Base 合约已用这台笔记本电脑的 `LIVE_` 密钥部署到 Base Sepolia（MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`，`infra/deployments/base-sepolia.json`），其联盟部署在笔记本电脑的本地 FISCO 链上（实链模式，D74、D75）。生产 compose 覆盖文件、演练目标和生产拒绝检查均已存在，演练已于 2026-10-18 在分叉上通过（M18，D90；第 9 节）。云端部署是 **Phase C 的一个步骤，由人工参与完成**（spec 10），目前尚未进行。服务器是位于香港的 Google Cloud 虚拟机（第 2 节）。它所需的脚本已经存在，但只在这台笔记本电脑上测试过，从未针对服务器或 Phala Cloud 运行：`scripts/deploy/server-bootstrap.sh`（在 `ubuntu:24.04` 容器中运行两次）、`scripts/deploy/build-images.sh`，以及 TEE 文件 `infra/phala/*.compose.yml` 和 `scripts/deploy/phala-deploy.sh`（针对替身命令，第 7 节）。第 9 节按顺序给出服务器上的步骤。本文档给出已经存在的命令，明确说明 Makefile 在哪些地方尚未与 spec 11 一致，Phase C 也在此记录所使用的值（绝不记录任何密钥）。中文版由英文版翻译，以英文版为准。

## 1. 环境

笔记本电脑和服务器运行相同的镜像和相同的 compose 文件；只有 `.env` 和一个覆盖文件不同（spec 11）。

| 模式 | 启动方式 | `PRAETOR_ENV` | Base | FISCO | TEE | 公开 URL |
|---|---|---|---|---|---|---|
| 本地 | `make up`（`infra/compose.yml`） | `local` | Base Sepolia 的 anvil 分叉（`CHAIN_MODE=fork`，`LOCAL_` 密钥） | Docker 中的 4 个节点 | dstack 模拟器（`ATTESTATION_MODE=simulator`） | `https://praetor.localhost`（Caddy 内部 CA） |
| 本地实链 | `make up LIVE=1`（加入 `infra/live.env`） | `local`（`LIVE=1` 不改变它） | Base Sepolia（`CHAIN_MODE=live`，`LIVE_` 密钥，不启动 anvil；通过 `https://base-sepolia-rpc.publicnode.com` 读取，D92） | 同一条本地链，由 `LOCAL` 密钥集治理（`FISCO_KEYSET=LOCAL`，D75） | 模拟器 | 同上，另加供手机使用的 `make tunnel` |
| 演练 | `make rehearsal`（`compose.yml` + `compose.prod.yml`） | `rehearsal` | 取自 `.env` 的 `CHAIN_MODE`：除非 `.env` 设置了实链值，否则为分叉（该目标不传 `LIVE=1`） | 同上 | 模拟器（生产拒绝规则单独检查） | `https://praetor.localhost` |
| 生产 | 服务器，`compose.yml` + `compose.prod.yml`（第 9 节） | `prod` | Base Sepolia | 服务器自己的 4 个节点 | Phala Cloud CVM（`ATTESTATION_MODE=phala`） | `https://app.<domain>` |

只有 `PRAETOR_ENV=prod` 会触发生产环境的拒绝规则，因此演练仍可以在模拟器上启动。

## 2. 生产环境拓扑

- **一台服务器**：位于 `asia-east2`（香港）的 Google Cloud Compute Engine 虚拟机，`e2-standard-4`（4 vCPU，16 GB，x86_64），Ubuntu 24.04 LTS（标准镜像，不是 Minimal 版），80 GB 平衡永久磁盘和一个静态外部 IPv4。VPC 防火墙只允许 tcp 22、80 和 443；`scripts/deploy/server-bootstrap.sh` 安装 Docker、开放同样三个端口的 ufw、一个非 root 的部署用户和自动安全更新。spec 00 指定的是腾讯云轻量应用服务器香港，其身份审核需要 2 到 4 个工作日：它仍是备选方案，脚本和步骤相同，只是用轻量服务器的防火墙代替 VPC 规则。默认 VPC 在 `asia-east2` 的子网是 `10.170.0.0/20`，自动模式 VPC 的所有子网都位于 `10.128.0.0/9` 之内，不会与整套服务的 Docker 网络（`10.88.0.0/16`、`10.89.0.0/24`、`10.90.0.0/24`）重叠；初始化脚本会拒绝路由落在这些网络之内的主机，并把 Docker 网桥的 MTU 降到 VPC 的 1460 字节。服务器运行 Caddy（通过 `CADDY_TLS` 为 `app.<domain>` 获取 ACME 证书，仅 DNS，不使用 CDN 代理）、MySQL、api、mcp、agent-runner（每个活跃用户一个 OpenCode 实例）、scheduler、bundler、notifier、oracle-feeder、三个成员服务、bridge-relayer、WeCross 路由器和账户管理器、四个 FISCO 节点、WeIdentity 以及各个模拟服务。
- **两台 Phala Cloud CVM**（`tdx.small`：1 vCPU，2 GB，带 dstack 的 Intel TDX，每台每小时 0.058 美元）：`agent-signer` 和 `soter-attester`，两个独立的度量值。2026-10-19 时工作区只列出 `US-WEST-1` 的节点，所以每次 TEE 调用都要从香港到美国西海岸；约 5 美元的额度可让两台 CVM 运行约 43 小时。
- **外部服务**：Base Sepolia RPC、大模型（OpenCode Zen，DeepSeek）、Pyth Hermes、腾讯的微信 API、浏览器的推送服务。

## 3. 配置与密钥

- `.env` 保存所有密钥和机密，权限 600，被 git 忽略。`pnpm keys` 只填充缺失的值（三套钱包密钥、共享机密、用于 Web 推送的 VAPID 密钥对），并且只打印公开地址。spec 11 要求生产密钥**在服务器上生成**；服务器改为复用笔记本电脑上已充值的 `LIVE_` 密钥进行新的 Base 部署（第 5 节，D100），并由 `pnpm keys` 生成其共享机密。
- 密钥集（D1）：`.env` 为每个钱包密钥保存 `LOCAL_*`、`LIVE_*` 和 `SANDBOX_*` 三份。`make up` 会写入 `.run/compose.env`，以不带前缀的名称保存当前密钥集（`CHAIN_MODE=live` 时为 `LIVE`，否则为 `LOCAL`）；设置了 `FISCO_KEYSET` 时，FISCO 侧的密钥取自它（D75）。
- EIP-712 域名必须与部署一致：live Base Sepolia 使用 `DOMAIN_NAME=Praetor`，评委自己的沙盒部署使用 `Praetor-sandbox`（尚未构建；临时的 `/sandbox` 页面运行在主部署上，其水龙头在线上 Base 拒绝工作）。
- 与 `infra/.env.example` 不同的生产值：

| 变量 | 生产值 |
|---|---|
| `PRAETOR_ENV` | `prod` |
| `PUBLIC_HOST`、`PUBLIC_URL` | `app.<domain>`、`https://app.<domain>`（passkey 绑定到这个主机名） |
| `CADDY_TLS` | ACME 账户邮箱（`compose.prod.yml` 把它传给 Caddy；默认为 `internal`） |
| `CHAIN_MODE`、`BASE_RPC_URL` | `live`，一个支持宽范围 `eth_getLogs` 的 Base Sepolia RPC：`https://base-sepolia-rpc.publicnode.com`，与 `infra/live.env` 相同（D92）。`sepolia.base.org` 把 `eth_getLogs` 限制在 200 个区块以内，对 payout partner、scheduler、api、notifier、oracle feeder 和 reader 来说太少；publicnode 允许 50,000 个区块（从部署区块起约 28 小时），因此连续运行数天的服务器需要 Base 客户端拆分宽范围的 `eth_getLogs`（后续工作，尚未构建） |
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

实链预算有意保持很小（D74）：由人工为部署者充值，而 Base Sepolia 的 gas 价格（测量时约 0.006 gwei）使运行成本很低。实链运行按部署者 0.0133 ETH、treasury 44 USDC 的预算规划，2026-10-18 的 M16 证据运行也控制在这一预算之内（D74、D96）。

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

**现有部署。** 2026-10-18，这一流程在 Base Sepolia 的区块 48253270 部署了 Praetor，总共约花费 0.0045 ETH（MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`，即 M16 证据运行）。hook 的三个成员地址是不可更改的构造函数参数（bank `0x9D45C4755CD26acAf3DAb12fE2c1B42AAdd1d52e`、regulator `0x5faaf3F8CC672A5357E648C9dfD81cD84d21e4e0`、operator `0x353046676e122D8eCb6F474A3aA57DBb338A525f`）。

**服务器使用同一套 `LIVE_` 密钥重新部署 Base 合约；不要在现有部署后面接一条新的 FISCO 链（D100）。** hook 只接受其键的下一个 nonce 的联盟消息（`ConsortiumLib._fresh`：`nonce == stored + 1`；`Anchor`：`seq == stored + 1`；I18），而全新的 FISCO 联盟会让每个键重新从 1 开始编号（`Board._allocate`）。2026-10-19 时，hook 上的心跳 epoch 为 6，anchor seq 为 3，风险档 2 的限额 nonce 为 1，各资产已激活。如果在它后面接服务器的新链：

- `bootstrapConsortium`（`scripts/demo/lib.ts`）读取 Base，发现限额和资产已设置，于是不发起任何提案；服务器上的 `MandateRegistry` 和 `AssetRegistry` 保持为空，每次策略检查（`submitPolicy`）都以 `RULE_HARD_CAP` 或 `RULE_ASSET_NOT_ACTIVE` 失败：开户流程停在 mandate 这一步。
- 即使强行发起提案，Base 上也不会改变：relayer 发现 hook 已处于这些 nonce（`BadNonce`，标记为已应用），Base 保留旧值。
- 心跳 epoch 1 到 6 和 anchor 1 到 3 同样被丢弃：在 epoch 7 之前 Base 状态一直过期，每笔 agent 支付都是 `STALE_STATUS`，anchor 要到 seq 4 才恢复。

在服务器克隆仓库之前，从笔记本电脑（它有 forge、子模块和 `.env`）重新部署：

```bash
cp infra/deployments/base-sepolia.json infra/deployments/base-sepolia-m16.json   # 保留 M16 的地址记录
# 1. 取回旧 paymaster 在 EntryPoint 的押金（约 0.004 ETH）：其 owner 是 LIVE 部署者。
EP=0x0000000071727De22E5E9d8BAf0edAc6f37da032; OLD_PM=0x1A5514F4752683b2f7e032c36529260dacf98c94; RPC=https://sepolia.base.org
DEP=$(cast call $EP "balanceOf(address)(uint256)" $OLD_PM --rpc-url $RPC | cut -d' ' -f1)
cast send $OLD_PM "withdrawTo(address,uint256)" 0x7b5bB06482513F6032baD053018ee387A7dac771 $DEP \
  --private-key "$(grep -E '^LIVE_DEPLOYER_KEY=' .env | cut -d= -f2-)" --rpc-url $RPC
# 2. 先模拟，再以 0.003 ETH 的 paymaster 押金部署。
DRY_RUN=1 make deploy-contracts ENV=base-sepolia
PAYMASTER_DEPOSIT_WEI=3000000000000000 make deploy-contracts ENV=base-sepolia
# 3. 提交 infra/deployments/base-sepolia.json 和 base-sepolia-m16.json，并推送。
```

- **费用**：2026-10-18 的部署用了 42 笔交易、约 3,040 万 gas，按 0.006 gwei 约 0.0002 ETH，另加新的 paymaster 押金。2026-10-19 时部署者只有约 0.0023 ETH，所以必须先取回旧押金，这不是可选项；取回后重新部署的成本基本可以抵消。成员、喂价者、交易台运营者、paymaster 签名者和金库的地址都不变，无需再为其他地址充值。新的 `deployBlock` 也会让 `eth_getLogs` 的范围重新开始（D92、D98）。
- **模拟运行**会在不广播的情况下执行 `Deploy.s.sol`，而脚本即使这样也会写入 `infra/deployments/base-sepolia.json`（`vm.writeJson`）：如果在模拟后停止，或部署失败，用 `git checkout infra/deployments/base-sepolia.json` 恢复该文件。
- **顺序**：服务镜像会把 `infra/deployments` 打包进去，所以要在服务器克隆和构建之前提交新文件。随后第 6 节部署绑定到新 hook 的服务器联盟。
- **密钥**：服务器持有笔记本电脑的 `LIVE_` 密钥（Base 信任的、已充值的地址），这偏离了 spec 11 的“在服务器上生成生产密钥”；服务器上的 `pnpm keys` 仍会重新生成所有共享机密。用服务器新生成的密钥部署也可行，但需要人工重新为每个新地址充值（第 4 节）。服务器上线后，笔记本电脑不再运行 live 模式：两者会从同一批 `LIVE_` 地址发送交易（D97）。
- **M16 部署**在押金取回后不再有赞助（这是预期的）；`docs/EVIDENCE.md` 继续引用它的地址，由 `base-sepolia-m16.json` 作为依据。

`SOTER_COUNTER_STRICT` 是 hook 的构造函数参数（默认 true）；如果 Phase C 发现 iOS 上 SOTER 计数器不递增，就需要用 `SOTER_COUNTER_STRICT=0` 重新部署（已知风险 16）。

## 6. 部署 FISCO 联盟链

```bash
make deploy-fisco ENV=live               # 写入 infra/deployments/fisco-live.json，绑定到 base-sepolia.json
```

`scripts/fisco/deploy.ts` 先一次性初始化 FISCO 治理（regulator 和 operator 作为治理委员，权重 51/51，然后设置部署白名单：部署者、WeIdentity 管理员、WeCross 的 FISCO 账户，Q22），再部署成员注册表、各个提案板（board）、审计日志和 outbox，并绑定到同一环境的 Base 部署（hook 地址和域名）。它通过 `FISCO_RPC_URL_HOST` 访问 FISCO（默认 `http://10.88.1.10:8545`，即 Docker 网络上的 node0），因此要在链启动后于链所在的机器上运行。FISCO 侧的密钥取自 `FISCO_KEYSET`，否则取自该环境的密钥集：在笔记本电脑上，实链联盟是用 `LOCAL` FISCO 账户部署在本地链上的（D75），因此目前的 `fisco-live.json` 指向笔记本电脑的链；服务器自己的链需要用其 `LIVE_` FISCO 密钥再次运行该命令。WeIdentity 的合约由 compose 文件中的 `weid-deploy` 任务部署，WeCross 的 hub 和 proxy 由 `wecross-setup` 部署。

## 7. Phala Cloud 上的 TEE

两台 CVM 的 compose 文件是 `infra/phala/agent-signer.compose.yml` 和 `infra/phala/soter-attester.compose.yml`；`scripts/deploy/phala-deploy.sh` 负责构建、推送并部署它们。两者都尚未在 Phala Cloud 上运行过（`test/infra/phala-deploy.test.ts` 用替身 `docker` 和 `phala` 命令运行该脚本）。

- **哪些内容被度量。** 每个文件只运行一个服务，设置 `PRAETOR_ENV=prod`、`ATTESTATION_MODE=phala` 和 dstack 套接字（`/var/run/dstack.sock`），镜像**按 digest** 引用（tee-checklist 第 2 项）。文件中写明的一切都计入 CVM 的 compose 哈希：镜像 digest；agent-signer 的 `PUBLIC_URL`（它只为 `<PUBLIC_URL>/mcp` 签署智能体名片，所以要先确定域名）；soter-attester 的 `DEPLOYMENTS_FILE`，即烘焙进其镜像的 `base-sepolia.json`（Base 重新部署后需重新构建）；真实的微信 API 地址。加密变量名列表（`allowed_envs`）以及公开日志和系统信息开关也计入；机密的值不计入，因此只改值不会改变哈希。
- **加密环境变量**是唯一不被度量的输入：agent-signer 为 `SIGNER_HMAC_MCP`、`SIGNER_HMAC_API`、`SIGNER_HMAC_BANK`；soter-attester 为 `ATTESTER_HMAC_API`、`MP_APPID`、`MP_SECRET`；若镜像为私有，两者还各加 `DSTACK_DOCKER_REGISTRY`、`DSTACK_DOCKER_USERNAME` 和 `DSTACK_DOCKER_PASSWORD`，Phala 的预启动脚本在拉取镜像前用它们登录。HMAC 必须与服务器上的相同：第 9 节把它们从笔记本电脑的 `.env` 复制到服务器的 `.env`。
- **命令**，在笔记本电脑上执行（它有 `phala` 1.1.22、`.env` 中的 API 密钥和 Docker）。没有 `PHALA_CONFIRM=1` 时脚本什么也不做：

```bash
gh auth refresh -s write:packages && gh auth token | docker login ghcr.io -u hliosone --password-stdin   # 一次即可：目前的 gh 令牌无法推送 package
PHALA_CONFIRM=1 REGISTRY=ghcr.io/hliosone scripts/deploy/phala-deploy.sh build   # git archive HEAD，构建并推送；digest 写入 .run/phala/images.env
PHALA_CONFIRM=1 PUBLIC_URL=https://app.<domain> scripts/deploy/phala-deploy.sh deploy
export PHALA_CLOUD_API_KEY="$(grep -E '^PHALA_CLOUD_API_KEY=' .env | cut -d= -f2-)"   # 笔记本电脑上的 CLI 没有登录
phala cvms get praetor-agent-signer --json; phala cvms get praetor-soter-attester --json   # app id、compose 哈希、访问地址
```

  `build` 从已提交的代码树构建两个镜像（不含未跟踪文件和未提交的修改），打印 commit 和烘焙进 soter-attester 的 hook，然后推送。请从服务器运行的那个 commit 构建，至少要保证 `infra/deployments/base-sepolia.json` 相同。`deploy` 创建 `praetor-agent-signer` 和 `praetor-soter-attester`（`tdx.small`，`--no-dev-os` 即生产 OS 镜像，`--no-public-logs`），若同名 CVM 已存在则原地更新。它从 `ENV_FILE`（默认 `.env`）读取机密，删除交给 `phala` 的 env 文件，并把渲染后的 compose 文件和 phala 的返回保存在 `.run/phala/`。
- **镜像仓库，由人工决定。** 代码仓库是私有的，从它推送的 GHCR package 默认也是私有的。要么把这两个 package 设为公开（GitHub 上的 package 设置）：镜像会因此公开源代码树，因为 `infra/node-service.Dockerfile` 复制整个构建上下文（被跟踪的文件减去 `.dockerignore` 排除的部分：没有 `.env`、没有密钥、没有文档）。要么保持私有，并在 `deploy` 之前把一个只有 `read:packages` 权限的 classic 令牌以 `DSTACK_DOCKER_REGISTRY=ghcr.io`、`DSTACK_DOCKER_USERNAME=hliosone`、`DSTACK_DOCKER_PASSWORD=<令牌>` 加入笔记本电脑的 `.env`（GHCR 只接受 classic 令牌）。这些变量名会进入 `allowed_envs`，从而进入 compose 哈希：在登记哈希之前做出决定（第 8 节）。
- **访问地址。** Phala 网关以 `https://<app-id>-3050.<网关域名>` 和 `https://<app-id>-3060.<网关域名>` 提供这两个端口，并在网关终止 TLS（CVM 内部的 TLS 仍是 tee-checklist 第 6 项）。只有 `/health` 不需要调用方 HMAC；`/v1/info` 和所有 `/v1` 路由一样需要 HMAC，因此请用 `phala cvms get` 读取 app id 和 compose 哈希，并确认每台 CVM 运行的是生产（非开发）OS 镜像。这些 URL 就是服务器的 `AGENT_SIGNER_URL` 和 `SOTER_ATTESTER_URL`（第 9 节）。
- **一旦有账户，就不要删除并重建 agent-signer。** CVM 从其 app id 派生所有智能体密钥（`getKey`）；新 CVM 意味着新的 app id，也就意味着每个账户都换了密钥（见下文）。请原地更新：用同一名称再次 `deploy`。
- **OS 镜像。** CLI 选用默认镜像（2026-10-19 时为 `dstack-0.6.1`）；各服务使用 0.5 版 SDK，并在 0.5.3 模拟器上测试过。如果套接字调用失败，用 `PHALA_OS_IMAGE=dstack-0.5.12` 部署。

密钥在 CVM 内部派生（`getKey`），因此生产环境的智能体密钥与模拟器派生的不同：每个现有账户都需要为新 TEE 中的密钥重新获得 KYA 并执行 `SET_AGENT_KEY`。F10 的轮换接口（`POST /api/agent/rotate`）会在 TEE 的各个密钥版本中查找 Base 上持有的那把密钥，更换 TEE 之后将找不到，因此现有账户需改走开户接口（`POST /api/onboarding/agent/create`，然后是授权、KYA 和 `SET_AGENT_KEY`）。这条路径是从代码中推断出来的，**尚未运行过**（既未验证银行能否为已持有另一 TEE 所签 KYA 的账户签发新的 KYA，也没有对应的 Web 应用界面）；需在 Phase C 中验证。切换之后创建的账户无需任何操作。

## 8. 向银行登记 compose 哈希

1. 把两个 compose 哈希（用 `phala cvms get` 读取，第 7 节；带 `0x` 前缀，多个时用逗号分隔）分别写入银行的 `ALLOWED_COMPOSE_HASHES_AGENT` 和 `ALLOWED_COMPOSE_HASHES_ATTESTER`，然后重启 bank。在 `ATTESTATION_MODE=phala` 下，没有智能体白名单时 bank 拒绝启动。
2. 激活 attester：银行签发一个 nonce（`POST /attesters/nonce`），attester 的 quote 通过 Phala 的验证服务校验（`POST /attesters/verify`），然后银行用经过验证的度量值签署 `AttesterAttestation`（D33）。它经由传输层到达 Base。
3. **每次变更都要重新登记**：镜像或 CVM compose 文件的任何变更都会改变哈希；在新 CVM 提供服务之前登记新哈希，激活新的 attester，并由任意一个成员停用旧的 attester（tee-checklist 第 4 项）。

如果 Phala 的验证 API 无法访问或返回格式不同，[MANUAL.md](../MANUAL.md) 第 2 步给出了备选方案。完整检查清单：[security/tee-checklist.md](../security/tee-checklist.md)。

## 9. 启动整套服务

**在笔记本电脑上演练（M18）：**

```bash
make rehearsal     # PRAETOR_ENV=rehearsal make up PROD=1，然后 make e2e-smoke（F1、F5、F8），然后 scripts/deploy/prod-refusals.sh
```

`compose.prod.yml` 为每个长期运行的服务加上重启策略、为所有服务加上日志轮转，把脚本化模型移到 `test` profile，把 `CADDY_TLS` 传给 Caddy，并停用明文 HTTP 的隧道站点。`prod-refusals.sh` 以 `PRAETOR_ENV=prod` 及各自的仅测试设置（模拟器证明、伪造的腾讯接口、伪 LLM）分别运行一次 bank、agent-signer、soter-attester、agent-runner 和 api，并期望每个服务都拒绝启动。

已于 2026-10-18 通过（D90）：冒烟测试 F1、F5、F8 16/16，五项生产拒绝检查均通过；此前修复了演练发现的三个问题（scheduler 的区间检查不再重叠，每项拒绝检查在无网络的情况下运行，api 在连接 MySQL 之前就拒绝伪造的腾讯接口）。冒烟测试使用的是脚本化模型（本地栈的 fake-llm 容器仍在运行，而 `PRAETOR_ENV=rehearsal` 允许使用它；在生产环境中 agent-runner 会拒绝 `FAKE_LLM_URL`）。未演练：实链 Base、Phala TEE 和真实证书（Phase C）。

**在服务器上（Phase C，Google Cloud）。** 尚未运行。按顺序执行，`<ip>` 为静态 IP，`app.<domain>` 为主机名，`praetor` 为部署用户。第 6 和第 8 步在笔记本电脑上运行，可与第 5 和第 7 步同时进行。

1. **虚拟机**（Google Cloud 控制台）。Compute Engine，区域 `asia-east2`，`e2-standard-4`，启动盘 Ubuntu 24.04 LTS x86/64（不要 Minimal 版），80 GB 平衡永久磁盘。在网络设置中勾选“允许 HTTP 流量”和“允许 HTTPS 流量”，并预留一个静态外部 IPv4。在安全设置中加入笔记本电脑的 SSH 公钥（GCP 以公钥的注释作为用户名：下文为 `hliosone`）。在 VPC 防火墙规则中删除 `default-allow-rdp`（若只保留 22、80 和 443，也删除 `default-allow-icmp`）。然后把 `app.<domain>` 指向该 IP（A 记录，仅 DNS，TTL 300）：Caddy 首次启动时就会申请证书。也可以用 gcloud（笔记本电脑上未安装；尚未运行）：

   ```bash
   gcloud compute addresses create praetor-ip --region asia-east2
   gcloud compute instances create praetor --zone asia-east2-a --machine-type e2-standard-4 \
     --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-size 80GB --boot-disk-type pd-balanced \
     --address praetor-ip --tags http-server,https-server
   gcloud compute firewall-rules create praetor-web --allow tcp:80,tcp:443 --target-tags http-server,https-server
   ```

2. **初始化**（从笔记本电脑执行；在容器中约 1.5 分钟，尚未在虚拟机上计时）：

   ```bash
   scp scripts/deploy/server-bootstrap.sh hliosone@<ip>:
   ssh hliosone@<ip> sudo bash server-bootstrap.sh   # Docker、用户 praetor（带上你的 SSH 公钥）、ufw、swap、Node、pnpm、cast
   ssh -t praetor@<ip> docker login                   # Docker Hub：约十个基础镜像来自那里，匿名拉取每小时上限 10 次
   ```

   如果主机路由落在整套服务的网络之内，它会拒绝继续；如果 `praetor` 无法获得 uid 1000，它会打印 `UID_GID=<uid>:<gid>`（WeCross 容器以该用户写入 `infra/wecross/generated`）：在第 4 步把这一行加入 `.env`。
3. **代码仓库**（私有）：一把只读的部署密钥，不需要子模块（服务器不构建合约）。

   ```bash
   ssh praetor@<ip> 'ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub' > /tmp/praetor-server.pub
   gh repo deploy-key add /tmp/praetor-server.pub -R hliosone/Praetor --title praetor-server
   ssh praetor@<ip> 'GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new" git clone -q git@github.com:hliosone/Praetor.git ~/praetor'
   ```

   这把密钥不能推送：服务器的 `fisco-live.json` 用 `scp` 拷回笔记本电脑（第 12 步）。
4. **`.env`**（权限 600）。只从笔记本电脑复制服务器要复用的内容，再加入生产值，其余交给 `pnpm keys` 生成：

   ```bash
   grep -E '^(LIVE_[A-Z0-9_]+|SIGNER_HMAC_(MCP|API|BANK)|ATTESTER_HMAC_API|MP_APPID|MP_SECRET|PYTH_API_KEY|OPENCODE_API_KEY|OA_[A-Z_]+)=' .env \
     | ssh praetor@<ip> 'set -C; umask 077; cat > ~/praetor/.env'   # 只执行一次：已有 .env 时拒绝覆盖
   ssh praetor@<ip>
   cd ~/praetor && cat >> .env <<'END'
   PRAETOR_ENV=prod
   CHAIN_MODE=live
   PUBLIC_HOST=app.<domain>
   PUBLIC_URL=https://app.<domain>
   CADDY_TLS=<ACME 账户邮箱>
   ATTESTATION_MODE=phala
   SOTER_FAKE_TENCENT=0
   FAKE_LLM_URL=
   VAPID_SUBJECT=mailto:<推送服务能够送达的地址>
   STANDING_ORDERS_INTERVAL_S=60
   AGENT_MAX_ACTIVE=4
   END
   make setup    # commit-msg 钩子，pnpm install --frozen-lockfile
   pnpm keys     # 填充所有缺失的机密（MySQL、会话、内部令牌、员工注册令牌、VAPID 等）
   ```

   - `LIVE_` 密钥对应已充值的地址和 hook 的成员（第 5 节）：绝不要重新生成。从此笔记本电脑不再运行 `LIVE=1`（D97）。
   - 四个 TEE HMAC 来自笔记本电脑，因为从笔记本电脑部署的 CVM 必须持有相同的值；`pnpm keys` 会保留它们（它只填充缺失的值）。
   - `CHAIN_MODE=live` 必须写在 `.env` 本身中：`infra/fisco/gen.sh` 只读取 `.env` 来选择链管理员，否则 `LOCAL_` 的银行密钥会成为管理员，`deploy-fisco` 随之失败。
   - 不要把 `infra/live.env` 中的值复制到 `.env`：`LIVE=1` 会在 `.env` 之后加入该文件，以它的值为准。
   - MySQL 密码必须在 MySQL 首次启动前确定（其初始化脚本只创建一次用户）。
   - `AGENT_MAX_ACTIVE=4`：一个 OpenCode 实例占用 350 到 850 MB（Q35），而这台 16 GB 的服务器还要运行其余所有服务。
   - 如果第 2 步打印了 `UID_GID`，把它加上。`AGENT_SIGNER_URL`、`SOTER_ATTESTER_URL` 和两个白名单在第 9 步加入。
5. **镜像**（服务器，在 tmux 中）：`bash scripts/deploy/build-images.sh` 下载 FISCO 二进制文件、构建其镜像、拉取 caddy 和 mysql，并用 make up 自己的 compose 命令构建生产 profile 的所有镜像。在笔记本电脑上用 4 个 CPU 冷构建 18 个镜像中的 17 个耗时 4 分 35 秒（agent-runner 未计时：在计时用的临时构建器中，它的预热步骤停住了）；在虚拟机上预计 5 到 10 分钟。镜像在运行它们的机器上构建：`make up` 会传入 `--build`，所以从笔记本电脑运过去的镜像（按 `docker save` 测得 1.87 GB）无论如何都会被重新构建，而且它们来自笔记本电脑的工作区，而不是服务器上的 commit。
6. **TEE 镜像**（笔记本电脑，与第 5 步同时进行）：`PHALA_CONFIRM=1 REGISTRY=ghcr.io/hliosone scripts/deploy/phala-deploy.sh build`（第 7 节，在选定镜像仓库之后）。确认它打印的 commit 与服务器上 `git rev-parse HEAD` 的结果一致。
7. **FISCO 链及其联盟**（服务器）。单独运行 `make up` 会在 `deploy-fisco` 打开部署白名单（Q22）之前启动 `wecross-setup` 和 `weid-deploy`，而且所用的 `fisco-live.json` 指向笔记本电脑的链，所以先启动基础服务和联盟：

   ```bash
   export CHAIN_MODE=live FISCO_KEYSET=LIVE P="core chain mocks agent wecross"
   mkdir -p apps/web/dist infra/wecross/generated
   bash scripts/dev/compose-env.sh    # .run/compose.env：LIVE 的钱包密钥和 FISCO 密钥
   bash infra/fisco/gen.sh            # 4 个节点，管理员为 LIVE 的银行 FISCO 账户
   make up-base PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"   # mysql、caddy（申请证书）、fisco-node0..3
   make deploy-fisco ENV=live         # 先治理，再部署绑定 base-sepolia.json 的联盟：写入 fisco-live.json
   ```

   每次 make 调用都要带上 `FISCO_KEYSET=LIVE`：单独的 `LIVE=1` 会导出 `FISCO_KEYSET=LOCAL`（D75，这是针对笔记本电脑的选择）。
8. **TEE CVM**（笔记本电脑，`PUBLIC_URL` 确定之后）：`PHALA_CONFIRM=1 PUBLIC_URL=https://app.<domain> scripts/deploy/phala-deploy.sh deploy`，然后对每台 CVM 运行 `phala cvms get`（第 7 节）。
9. **让服务器指向 TEE**（服务器）：在 `.env` 末尾加入

   ```bash
   AGENT_SIGNER_URL=https://<agent-signer 的 app id>-3050.<网关域名>
   SOTER_ATTESTER_URL=https://<soter-attester 的 app id>-3060.<网关域名>
   ALLOWED_COMPOSE_HASHES_AGENT=0x<agent-signer 的 compose 哈希>
   ALLOWED_COMPOSE_HASHES_ATTESTER=0x<soter-attester 的 compose 哈希>
   ```

   智能体白名单为空时，bank 拒绝 `ATTESTATION_MODE=phala`。若 CVM 无法工作，备选方案是 `PRAETOR_ENV=rehearsal`、`ATTESTATION_MODE=simulator`、不设 CVM URL，并在 profile 中加入 `tee-sim`（[MANUAL.md](../MANUAL.md) 第 2 步）：模拟器的密钥材料是公开的，所以这台服务器上的 TEE 声明不成立，而且在已有账户后再切换会走第 7 节那条未经测试的重新 KYA 路径。请在为任何账户开户之前做出决定。如果 CVM 只是还没就绪，第 10 和第 11 步（C0，不含 attester）可以先在该模式下运行；在第一个账户或 attester 之前切换（`make down PROD=1 LIVE=1`，在 `.env` 中写入 Phala 的值，再执行第 10 步）。
10. **整套服务**（服务器）：`make up PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"`，然后 `make ps PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="$P"`（所有服务健康；`weid-deploy` 和 `wecross-setup` 以 0 退出）。它保留链，复用第 5 步的镜像，构建 Web 应用，连接 WeCross（`scripts/wecross/up.sh`）并启动其余服务；`weid-deploy` 首次运行时用 Gradle 编译 WeIdentity 的 Build-Tools。
11. **联盟初始化和价格**（服务器）：`pnpm exec tsx scripts/evidence/live-run.ts --only C0` 发起并中继上限、资产、CN 出款封锁和演示制裁，发送一次心跳，等待 feeder 推送首批 Pyth 价格，并从国库给新的 desk 转入 4 USDC；成功时打印 `C0:` 和两个 Pyth 价格，失败时打印 `C0: stopped:` 及原因。然后针对 CVM 激活 attester：

    ```bash
    SOTER_ATTESTER_URL_HOST=https://<soter-attester 的 app id>-3060.<网关域名> \
      pnpm exec tsx -e "import('./scripts/demo/lib.ts').then(async (l) => console.log(await l.activateSoterAttester(l.stack())))"
    ```

    批准控制台设备：在 `https://app.<domain>` 的控制台中为每个角色点击“注册此设备”，然后运行 `pnpm exec tsx scripts/demo/staff.ts <bank|regulator|operator> '<控制台给出的 json>'`。绝不要在实链上运行 `pnpm seed` 或 `scripts/demo/smoke-real-model.ts`：它们按分叉的金额充值，并用公开的标签创建所有者。
12. **账户、手机、记录。** 在 iPhone 上于 `https://app.<domain>` 开户（MANUAL 第 4 步），在账户获得 KYA 之后用 `pnpm exec tsx scripts/deploy/fund-account.ts <account> 5 2 1` 为其充值（每次最多 10 USDC，以及 6 和 3 美元的金属）。小程序：第 10 节。执行第 11 节的冒烟检查（自动化测试套件不在服务器上运行：它们使用脚本化模型和分叉金额），把 `infra/deployments/fisco-live.json` 拷回笔记本电脑（`scp praetor@<ip>:praetor/infra/deployments/fisco-live.json infra/deployments/`），提交它并填写第 11 节的表格。

**需要人工决定的事项**（当天之前或当天）：

- 第 1 步用 GCP 控制台还是 `gcloud`（笔记本电脑上未安装 gcloud）。
- 域名和 ACME 邮箱（`app.<domain>` 必须在第 7 步之前能够解析）。
- TEE 镜像的仓库：公开的 GHCR package（会公开源代码树），或私有 package 加一个作为加密环境变量的 `read:packages` 令牌（第 7 节）。
- 服务器上 `docker login` 所用的 Docker Hub 账号（匿名拉取：每个 IP 每小时 10 次）。
- Phala 额度：目前约够两台 CVM 运行 43 小时；评审期间每天约需 2.8 美元。
- 在第一个账户之前，选择 Phala 还是模拟器备选方案（第 9 步）。

## 10. 隧道、手机和小程序域名

- **手机连接笔记本电脑上的栈**（本地或 `make up LIVE=1`）：`make tunnel` 启动一个 cloudflared 快速隧道（`--protocol http2 --edge-ip-version 4`，即 Phase 0 中验证过的参数），通过本机的明文 HTTP 连接 Caddy，把 URL 写入 `.run/tunnel-url`，并把小程序的 develop 环境指向它；`make tunnel-stop` 结束隧道。每次启动都会得到新地址。`compose.prod.yml` 停用了隧道站点，因此生产 compose 从不使用它。测试人员的步骤：[TESTER.md](../TESTER.md)。
- **Passkey 绑定主机名**（WebAuthn rpId）：若要在手机浏览器中对笔记本电脑上的栈使用 Face ID，需把 `PUBLIC_HOST` 和 `PUBLIC_URL` 设为隧道地址并再次运行 `make up`；此时自动化测试套件不适用（它们要求 `praetor.localhost`）。在 `praetor.localhost` 或隧道上创建的 passkey 只能在那里使用；部署后需要在 `app.<domain>` 上重新注册。
- **小程序**：它以**调试模式**运行在团队手机上的微信测试账号中，因此不受域名白名单限制。把它的三个环境都指向域名，因为在手机上用开发者工具预览时运行的是 `develop`（微信的开发版）：`for e in develop trial release; do node apps/miniprogram/scripts/set-api-base.mjs $e https://app.<domain>; done`。公众号回调 URL 也改为该域名。

## 11. 冒烟检查与记录

spec 11 第 7 步要求运行 `make e2e BASE_URL=https://app.<domain> CHAIN_MODE=live`。测试套件目前并不读取 `BASE_URL`：`scripts/demo/lib.ts` 通过 Docker 网络（10.88.x）访问各服务，因此其辅助脚本在服务器本机上运行（它从 `PUBLIC_HOST` 和 `PUBLIC_URL` 读取 WebAuthn 主机，D99），而且 `make e2e` 最后运行需要 anvil 的 48 小时 warp 测试。目前存在的是：笔记本电脑上的 `make rehearsal`，以及针对同一台机器上运行的栈的 `make e2e-smoke`。在测试套件能通过域名访问整套服务之前，针对已部署域名的检查需要人工完成：在 `https://app.<domain>` 上执行 [MANUAL.md](../MANUAL.md) 的第 4、8 和 11 步，然后从中国大陆多个城市进行可达性检查（17CE）。绝不要针对服务器运行 `make e2e`、`make e2e-smoke` 或 `make e2e-live`：它们使用生产环境拒绝的脚本化模型，并按分叉的金额充值。在服务器上执行的只读检查（尚未运行）：

```bash
curl -s https://app.<domain>/api/health                                      # 经由 Caddy 访问 api
echo | openssl s_client -connect app.<domain>:443 -servername app.<domain> 2>/dev/null | openssl x509 -noout -issuer -dates
curl -sI https://app.<domain>/ | grep -i content-security-policy            # Caddy 的响应头已生效
make ps PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross"
make logs PROD=1 LIVE=1 FISCO_KEYSET=LIVE PROFILES="core chain mocks agent wecross" S=bridge-relayer   # 有投递记录，没有 BadNonce
RPC=https://base-sepolia-rpc.publicnode.com; D=infra/deployments/base-sepolia.json
cast call $(jq -r .mandateHook $D) "statusOf(address)(uint8,uint8,uint8,uint64)" 0x0000000000000000000000000000000000000000 --rpc-url $RPC   # 最后一个值：心跳有效期，应在未来
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 "balanceOf(address)(uint256)" $(jq -r .paymaster $D) --rpc-url $RPC   # paymaster 剩余的押金
bash scripts/deploy/prod-refusals.sh                                         # 5 个 ok
```

在下表记录所部署的内容（不含任何密钥）：

| 项目 | 值 |
|---|---|
| 日期、commit | Phase C |
| 域名、服务器 | Phase C |
| Base 部署 | `infra/deployments/base-sepolia.json`：MandateHook `0x839E104c8C2df983213a89CAcB58440Da4AdC2A9`，区块 48253270，2026-10-18 用笔记本电脑的 `LIVE_` 密钥部署；Phase C：用同一套密钥重新部署（第 5 节，D100），M16 的地址保留在 `base-sepolia-m16.json` |
| FISCO 部署 | `infra/deployments/fisco-live.json`：目前位于笔记本电脑的本地链上（D75）；Phase C：服务器自己的链 |
| agent-signer CVM：app id、compose 哈希 | Phase C |
| soter-attester CVM：app id、compose 哈希 | Phase C |
| 执行的命令 | Phase C |
