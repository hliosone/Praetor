# 执行证据：公开服务器

公开服务器 **https://app.praetorwallet.com**、它在 Phala Cloud 上的两个 TEE，以及在其上用微信完成的第一个账户运行，均在 **Base Sepolia（实链）** 上。本文件于 2026-10-20 根据 Base Sepolia 的读取结果手工编写（`eth_getTransactionReceipt`、`eth_getLogs` 与钩子的只读函数，经 `https://base-sepolia-rpc.publicnode.com`），下列每笔交易的回执状态均为 1。本文件不是自动生成的：[EVIDENCE.md](../EVIDENCE.md) 是 2026-10-18 在较早的 M16 部署上的证据运行，由 `scripts/evidence/collect.ts` 生成。英文版本为准：[EVIDENCE-SERVER.md](../EVIDENCE-SERVER.md)。

服务器上的金额按 `DEMO_SCALE` 100 缩放（D74）：链上 1 USDC 代表故事中的 100 USDC。

## 部署

| 项目 | 位置 |
|---|---|
| Web 应用与 api | https://app.praetorwallet.com：Google Cloud Compute Engine `e2-standard-4`，`asia-east2-a`（香港），Ubuntu 24.04，静态 IPv4 34.96.209.53（无 IPv6），由 Caddy 获取的 Let's Encrypt 证书（D104、D106）。操作步骤见 [DEPLOY.md](DEPLOY.md) 第 9 节 |
| Base Sepolia 合约 | 2026-10-19 的部署（D101），全部地址见 `infra/deployments/base-sepolia.json`，EIP-712 域 `Praetor`，部署区块 48301428。MandateHook [`0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`](https://sepolia.basescan.org/address/0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f) |
| FISCO BCOS 联盟 | 服务器自己的 FISCO 链与联盟（银行、监管机构、运营方），绑定到这个钩子（D100）。该链没有公开浏览器，因此这里不列出其调用 |
| 价格 | 来自 Pyth Hermes 的真实 XAU 与 XAG 价格；联盟初始化时 tXAU 4,132.30 USD、tXAG 56.89 USD |

## Phala Cloud 上的两个 TEE

两个 CVM 都运行在 Phala Cloud 的真实 Intel TDX 中（`tdx.small`，生产系统镜像 `dstack-0.5.12`，由 `scripts/deploy/phala-deploy.sh` 以 `--no-dev-os` 和 `--no-public-logs` 部署），使用在提交 `4b0f53b` 构建的私有 GHCR 镜像，按摘要引用（D104、D106）。机密均为加密环境变量。两个 compose 哈希都在银行的允许列表中。密钥只通过 CVM 内的 dstack `getKey` 产生，不会离开 CVM。

| CVM | Phala app id | Compose 哈希（银行允许的度量值） |
|---|---|---|
| agent-signer | `aaa39dc0d68be17ce5fa793b7d73e04d804270b3` | `0x0263abb547f749c270694185ecdc45be1f8ede2b7dc6a35b338aad3485f9f8d2` |
| soter-attester | `00071068a34978c975ece991044599f80c75d138` | `0x7328c4f30902aedf162b865698b2f73602bb38449c932c57a2d6966fac150469` |

**证明服务（attester）的激活。** 银行把 soter-attester 的 TDX quote（报告数据将证明服务密钥绑定到银行的一次性随机数）交给 Phala 的验证服务，验证通过后从 quote 的 MRCONFIGID 读取 compose 哈希（dstack 在其中写入 `0x01` 加 compose 哈希；Phala 的应答已不再包含 `app_info.compose_hash`，提交 `9056861`）。哈希在允许列表中，银行签署的 `AttesterAttestation` 经 WeCross 在 [`0x58cafa3e...4b9f3c24`](https://sepolia.basescan.org/tx/0x58cafa3eeb77dd5c6cccc2c5d5586e92b2fe4be3837dda5d7931c3f24b9f3c24) 到达 Base：attester `0xd690B2E7312082D48d7667f78FD04482bE91b846`，度量值为 soter-attester 的 compose 哈希，状态为激活。2026-10-20 读取钩子的 `attesterOf` 返回该哈希和 `true`。

**智能体密钥。** 服务器上的智能体密钥来自 agent-signer CVM；生产配置拒绝模拟器（I13）。该账户的 KYA 经 WeCross 在 [`0xdccb5c43...2056aee0`](https://sepolia.basescan.org/tx/0xdccb5c433526c782f7c61806d7b95cc74d90a80e153ca5e8fdbc119a2056aee0) 送达，其智能体度量值为 agent-signer 的 compose 哈希 `0x0263abb5...85f9f8d2`。

尚未证明的部分：调用方经 Phala 网关访问 CVM，TLS 在 CVM 之外终止（TEE 检查清单第 6 项）；银行依赖 Phala 的验证服务拒绝调试模式的 CVM，而不是自己解析 quote 的 TD 属性（第 1 项）：[security/tee-checklist.md](../security/tee-checklist.md)。

## 微信运行（2026-10-20，真实 iPhone）

一个账户 [`0xd157b7fd428bfe7217ea9d013fe9017774678731`](https://sepolia.basescan.org/address/0xd157b7fd428bfe7217ea9d013fe9017774678731)，在服务器上用通行密钥开户，并在 iPhone 上绑定微信小程序。被拒的付款、审批与执行共用同一个 callHash `0x601c4ae866e0b7e3a3b4d0ff5c3264024ce27bf7b54f446e6e89c10647335745`。

| 时间（UTC） | 步骤 | Base 上的事件 | 交易 |
|---|---|---|---|
| 00:21:00 | 银行激活 soter-attester，经 WeCross 送达 | `AttesterApplied`，激活 | [`0x58cafa3e...4b9f3c24`](https://sepolia.basescan.org/tx/0x58cafa3eeb77dd5c6cccc2c5d5586e92b2fe4be3837dda5d7931c3f24b9f3c24) |
| 00:28:16 | 银行为该账户的智能体密钥签发 KYA，经 WeCross 送达 | `KYAApplied` | [`0xdccb5c43...2056aee0`](https://sepolia.basescan.org/tx/0xdccb5c433526c782f7c61806d7b95cc74d90a80e153ca5e8fdbc119a2056aee0) |
| 00:28:36 | 所有者用通行密钥设置授权委托 | `OwnerActionApplied` SET_POLICY（0），PASSKEY；`PolicySet` | [`0xa92215aa...a5bbd6d8`](https://sepolia.basescan.org/tx/0xa92215aa4297750213f8207f4e47b4f12a4f1268b04df059ce203952a5bbd6d8) |
| 00:33:04 | 所有者用通行密钥更新授权委托 | `OwnerActionApplied` SET_POLICY（0），PASSKEY；`PolicySet` | [`0x93843b33...c5972fee`](https://sepolia.basescan.org/tx/0x93843b330f19da6d91eba3fa1c9d3136f2958e9ed8d449df6510107bc5972fee) |
| 00:52:44 | 绑定微信：所有者用通行密钥签署绑定，其载荷带有小程序的 SOTER 证明及证明服务的签名 | `OwnerActionApplied` LINK_WECHAT（3），PASSKEY | [`0x3312a0ea...7f22469a`](https://sepolia.basescan.org/tx/0x3312a0eab7c673060910f0dbcfc91d0992eaa0aaa6fae47dd6731dab7f22469a) |
| 00:54:48 | 向新收款方付款：链上拒绝，审批请求发到微信（T2） | `Refused` UNKNOWN_PAYEE（原因 7），T2 | [`0x2ef41395...83a945ab`](https://sepolia.basescan.org/tx/0x2ef4139547686147528a899d01e09e974c93184f849e0378809b786683a945ab) |
| 00:55:32 | 所有者在微信内用 Face ID（SOTER）批准；证明服务在其 Phala CVM 中向腾讯核验签名并签署审批 | `ApprovalRegistered`，SOTER（1） | [`0x9a6633db...f5b3ee18`](https://sepolia.basescan.org/tx/0x9a6633dbb93fff0d6694b737a503aa8fbdbf2e26e9305a1e48187ecef5b3ee18) |
| 00:55:36 | 批准的付款只执行一次：链上 1.00 USDC（故事中为 100 USDC），付给 `0x000000000000000000000000000000000000c0fe` | `ApprovalConsumed`；`Decision` OK，T2；USDC `Transfer` 1,000,000 单位 | [`0x0a900425...689b1ab2`](https://sepolia.basescan.org/tx/0x0a90042508153fe9e283fa59b3186f507ce022706416b10245cbe3bf689b1ab2) |
