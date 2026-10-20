# 执行证据：公开服务器

公开服务器 **https://app.praetorwallet.com**、它在 Phala Cloud 上的两个 TEE，在其上用微信完成的第一个账户运行，以及录制的演示运行，均在 **Base Sepolia（实链）** 上。本文件于 2026-10-20 根据 Base Sepolia 的读取结果手工编写（`eth_getTransactionReceipt`、`eth_getLogs` 与钩子的只读函数，经 `https://base-sepolia-rpc.publicnode.com`），下列每笔交易的回执状态均为 1。本文件不是自动生成的：[EVIDENCE.md](../EVIDENCE.md) 是 2026-10-18 在较早的 M16 部署上的证据运行，由 `scripts/evidence/collect.ts` 生成。英文版本为准：[EVIDENCE-SERVER.md](../EVIDENCE-SERVER.md)。

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

## 演示运行，2026-10-20（账户 0xe9c6c12121fbe4c627ab2fdddb01e0579e151b94）

同一天稍后录制的演示，使用第二个账户 [`0xe9c6c12121fbe4c627ab2fdddb01e0579e151b94`](https://sepolia.basescan.org/address/0xe9c6c12121fbe4c627ab2fdddb01e0579e151b94)：在服务器上用通行密钥开户，并在 iPhone 上绑定微信。下列每笔交易的回执状态均为 1，其事件按 `packages/protocol/src/events.ts` 中的 ABI 解码。账户的交易清单来自对钩子、RefusalLog、StandingOrders、PayoutRail、两个验证器和 EntryPoint 在区块 48340349 至 48350349 上的 `eth_getLogs`（该范围始于账户创建之前），并加上转入该账户的 USDC、tXAU 与 tXAG：查到的每笔交易都在表中。金额均为链上 USDC（`DEMO_SCALE` 100，见上文）。账户自身的交易由 Praetor 的 bundler（`0xd76eef0179d98f9aeaaad1f26d05d2425e2c9915`）发送，其用户操作由 paymaster 代付；KYA、两次状态变更和审计锚定经 WeCross 送达（发往 WeCrossProxy，发送方 `0xbD644c848D5eCD335725F0cBC51F1E04dC153C66`）。被拒的付款在 Base 上出现两次：其用户操作在账户内回滚（`UserOperationEvent` success 为 false，回滚 `ExecutionFailed()`），随后 bundler 把钩子给出的原因记入 RefusalLog（`Refused`）。

| 时间（UTC） | 流程 | 经过 | Base 上的事件、层级、原因 | 交易 |
|---|---|---|---|---|
| 03:28:24 | 开户 | 账户由其第一笔用户操作创建，并登记所有者的通行密钥 | `AccountDeployed`；PasskeyValidator 上的 `OwnerKeySet` | [`0x2875ab71...7df8478c`](https://sepolia.basescan.org/tx/0x2875ab71587c9dd21d1588c2e5f41a067eaee60ce713a72e6996e36b7df8478c) |
| 03:30:08 | 开户 | 银行为智能体密钥 `0x0B8cEf3e89ed93d2d5d99F6cc6d24329B98a7E8E` 签发 KYA，经 WeCross 送达 | `KYAApplied`，KYC 等级 2，风险类型 BALANCED（2），司法辖区 `HK` | [`0x92f5437c...d2734141`](https://sepolia.basescan.org/tx/0x92f5437cdfde1c0490968f63967c4e86a883bff2df15bc9d83001682d2734141) |
| 03:30:14 | 开户 | 所有者安装智能体密钥（通行密钥加银行签名，钩子对此操作要求银行签名） | `OwnerActionApplied` SET_AGENT_KEY（5），PASSKEY；`AgentKeySet` | [`0xc9058133...6766a0a6`](https://sepolia.basescan.org/tx/0xc905813381a29711318031ed7c1fc394b40de6f94c9170c3394e228f6766a0a6) |
| 03:30:22 | 开户 | 所有者设置授权委托，其中没有 Café Lumen | `OwnerActionApplied` SET_POLICY（0），PASSKEY；`PolicySet` `0x313ad4e7...481ee15b` | [`0x23f99d3e...f95fb2fd`](https://sepolia.basescan.org/tx/0x23f99d3e974aefc699a724154ce82ee02dff69d923573086daecce50f95fb2fd) |
| 03:33:00 | 开户 | 按目标配比注资：演示资金账户转入 6.00 USDC，交易台运营方铸造 tXAU（3.30 USD）与 tXAG（1.60 USD）（[`0x64aba087...9ca36032`](https://sepolia.basescan.org/tx/0x64aba087a7881032d90ee9d0fb8e98eba946dc339e90bb682b9876a89ca36032)、[`0x3b3fe10b...687a395c`](https://sepolia.basescan.org/tx/0x3b3fe10b7a7bf1766a9e6931340f822b5e00ee7d4ff9ba4af7107db8687a395c)） | USDC `Transfer` 6,000,000 单位 | [`0x927a4199...19f06bae`](https://sepolia.basescan.org/tx/0x927a4199a58c0a97602b2fd00d096638b8afedb074ec34aa136d9bd819f06bae) |
| 03:33:26 | F4 | 从外部地址存入 20.00 USDC：USDC 占 30.90 USD 中的 26.00，即 84 %，超出其 40 % 至 60 % 的区间 | USDC `Transfer` 20,000,000 单位 | [`0x9c856c78...3285e1c5`](https://sepolia.basescan.org/tx/0x9c856c7853115f28c943d146278d5dfc30dd08f44aecfcbeb0d3d22b3285e1c5) |
| 03:34:16 | 开户 | 所有者更新授权委托：Café Lumen（`0x80EB1086D34285Dd5de0b71cBaab019ba3E214f8`）成为已知收款方 | `OwnerActionApplied` SET_POLICY（0），PASSKEY；`PolicySet` `0x5555bb74...c5893dc7` | [`0x398db589...ce0b2beb`](https://sepolia.basescan.org/tx/0x398db589600bcecf7a1ea1d486599f49bdb28ecec6d5ac3161c8d1abce0b2beb) |
| 03:39:28 | 开户 | 用通行密钥绑定微信 | `OwnerActionApplied` LINK_WECHAT（3），PASSKEY | [`0x3a028287...f1439160`](https://sepolia.basescan.org/tx/0x3a0282871cd12ed378e6a67343340c77e03b1505d1dfee16176729e6f1439160) |
| 03:42:58 | F4 | 调度器唤醒智能体，智能体自主再平衡：在 TreasuryDesk 用 7.50 USDC 换入 tXAU（每 tXAU 4,143.82 USD）；USDC 回到 59.9 %，tXAU 34.9 % | `Decision` OK，T1，7.50 USD（之前的 USDC 授权：OK，T1，0 USD）；`Swapped` | [`0x77a74427...d5937a88`](https://sepolia.basescan.org/tx/0x77a744278b4369b400f8ba1f9dc270915c5c214f496bf11898d2a45ad5937a88) |
| 03:44:04 | F5 | 所有者再次签署授权委托；内容与 03:34:16 的完全相同（policyHash 相同），Café Lumen 已在其中 | `OwnerActionApplied` SET_POLICY（0），PASSKEY；`PolicySet` `0x5555bb74...c5893dc7` | [`0xebf79c99...a8cbcca7`](https://sepolia.basescan.org/tx/0xebf79c9900c5cf7c11e3b8dcf41c7b9713ab7696b49bef3d9e2d9831a8cbcca7) |
| 03:44:26 | F5 | 智能体自主向已知收款方 Café Lumen 付款：0.15 USDC | `Decision` OK，T1，0.15 USD；USDC `Transfer` 150,000 单位 | [`0xeb400c2d...a43a85f0`](https://sepolia.basescan.org/tx/0xeb400c2d46a2c53a6e6640b7772c9984d866bfb0d78e452655561529a43a85f0) |
| 运行期间 | F5b | 对真实模型（经 OpenCode 调用的 DeepSeek）进行提示注入：模型拒绝，因此没有发送任何用户操作 | Base 上无记录 | 无 |
| 03:45:12 | F7 | 所有者设置定期付款 1（通行密钥加银行签名，钩子对此操作要求银行签名） | `OwnerActionApplied` ADD_STANDING_ORDER（1），PASSKEY；`StandingOrderSet` id 1 | [`0x4f683ae1...d26661b2`](https://sepolia.basescan.org/tx/0x4f683ae16554cc63030d309fcb84739c8c37e79bf7fc942c46133a5ed26661b2) |
| 03:45:32 | F7 | 调度器经支付通道（Alipay+ 模拟）执行定期付款 1：0.20 USDC 转入 PayoutRail | `Decision` OK，T1，0.20 USD；`PayoutRequested` id 1，通道 ALIPAY_PLUS；`StandingOrderExecuted` | [`0xb4104cad...b45ce329`](https://sepolia.basescan.org/tx/0xb4104cad91461b6503aa61528af9539c3b0886d392ac2e97e7d44b2fb45ce329) |
| 03:45:42 | F7 | 支付合作方（`0xB5140A52cF031730Cde446b6C0ee2f2238dba5a5`）结算付款 1 | `PayoutSettled` id 1 | [`0xc3bf7f84...ff3e6a6f`](https://sepolia.basescan.org/tx/0xc3bf7f84fdcae86e63c1609f9a3d3fba1e99605ce8573a9d1e89c470ff3e6a6f) |
| 03:48:50 | F6 | 智能体向新收款方（`0x85491BB655FdDc5D1580039fec8Bb9106DDc807a`）付款 0.15 USDC：被拒（用户操作 [`0xdf711c43...19df22c6`](https://sepolia.basescan.org/tx/0xdf711c43a60197bb8ecbec93c4059192b73d9e3f3fdb893233f0291419df22c6)），审批请求发到微信 | `Refused` UNKNOWN_PAYEE（原因 7），T2 | [`0x23a62b45...c57fea00`](https://sepolia.basescan.org/tx/0x23a62b4594fa968b4380ab2570ce23f4f2b39994670d28cfba9fe34ac57fea00) |
| 03:49:34 | F6 | 所有者在微信内用 Face ID（SOTER）批准 | `ApprovalRegistered`，SOTER（1） | [`0x2a707c5d...588fa3d9`](https://sepolia.basescan.org/tx/0x2a707c5d8fd32a58ff13ae18dff9f4a4dea78d14801271814be5ab6c588fa3d9) |
| 03:49:38 | F6 | 批准的付款只执行一次：向新收款方付 0.15 USDC | `ApprovalConsumed`；`Decision` OK，T2，0.15 USD；USDC `Transfer` 150,000 单位 | [`0x08b37d27...ce0212b8`](https://sepolia.basescan.org/tx/0x08b37d27d1d1537520c499cb591d19f9301a05e8a344b599b20130d9ce0212b8) |
| 03:49:44 | F8 | 联盟经 WeCross 把其 FISCO 审计链的链头锚定到 Base：序号 9，FISCO 区块 751，写入 Anchor 合约 [`0x3429aef41f2ADBEeB57E5B17891C0DE6a3Ed2606`](https://sepolia.basescan.org/address/0x3429aef41f2ADBEeB57E5B17891C0DE6a3Ed2606)，该合约只接受带两个成员签名的链头 | `Anchored` seq 9，head `0xb4df5ccf...2a079f0e`，fiscoBlock 751 | [`0x71dedbdf...c823d778`](https://sepolia.basescan.org/tx/0x71dedbdf30be32181b7afba7764759b995070fb4a5978f9fd8818501c823d778) |
| 03:51:56 | F6 | 同一笔付款再次发起（callHash 相同）：第一次批准已用掉，因此再次被拒（用户操作 [`0xfa219bf8...93a21885`](https://sepolia.basescan.org/tx/0xfa219bf856b81c9d36ed08d4a27161ff0b1de707c7b9bb3407b3882e93a21885)） | `Refused` UNKNOWN_PAYEE（原因 7），T2 | [`0xa522deb4...a5dffbb0`](https://sepolia.basescan.org/tx/0xa522deb4b9ae7a637fd939275853e43bba4b575f9016fdf86ebb1aeba5dffbb0) |
| 03:52:14 | F6 | 在微信内用 Face ID 第二次批准 | `ApprovalRegistered`，SOTER（1） | [`0xcc207b88...31620e68`](https://sepolia.basescan.org/tx/0xcc207b88092e5d1f8c470c8ff504e79dd693efc94b34c9f4bd71bed631620e68) |
| 03:52:18 | F6 | 第二次批准只使用一次：向同一收款方付 0.15 USDC | `ApprovalConsumed`；`Decision` OK，T2，0.15 USD；USDC `Transfer` 150,000 单位 | [`0xc35ef38e...c33905dd`](https://sepolia.basescan.org/tx/0xc35ef38e29930a36f57d27eebf67cd5a0cf3eda4d9f93cbdcdcd0d9ac33905dd) |
| 03:55:38 | F9 | 监管机构单独冻结该账户，经 WeCross 送达 | `StatusApplied` FROZEN（2），nonce 1，signerCount 1 | [`0x1adb003c...775be758`](https://sepolia.basescan.org/tx/0x1adb003ce40cf768eb41cd97f83b1fb2a0835087f726694b68589b03775be758) |
| 03:57:20 | F9 | 智能体再次尝试 F5 中向 Café Lumen 的付款（callHash 相同）：被拒（用户操作 [`0x007775fb...da6842f1`](https://sepolia.basescan.org/tx/0x007775fbc545db7935bc1d3ed1c7bc5edfd81e9b1d28ed11b3439351da6842f1)） | `Refused` FROZEN（原因 1），T0 | [`0x5ff2ae9d...9e683e0d`](https://sepolia.basescan.org/tx/0x5ff2ae9d5d2a178941bb8f7da67f3a5e415b8157ac78c12210cf0e3d9e683e0d) |
| 03:57:56 | F9 | 放宽需要两个成员：监管机构与银行把账户恢复为 ACTIVE，经 WeCross 送达 | `StatusApplied` ACTIVE（0），nonce 2，signerCount 2 | [`0x5ef02cd6...55f0795b`](https://sepolia.basescan.org/tx/0x5ef02cd6ec2421cf830db4784c6750ed84cf55c3b5519514c498b4ca55f0795b) |

F4 的持仓数字取自再平衡前一个区块（48349744）：账户余额与 PriceOracle 的价格（tXAU 4,143.82 USD，tXAG 57.44 USD）。F6 的两次批准对应同一个 callHash，各自只消耗一次；钩子的 `approvalOf` 对该 callHash 现在返回第二次批准，`consumed` 为 true。`StatusApplied` 只记录签名者数量，不记录身份：由哪些成员签名来自运行记录。
