# 安全自评估

Praetor 让 AI 智能体动用用户的资金，因此设计上要回答的问题不是“智能体是否可信”（它不可信），而是“智能体或其周围的任何组件，最坏能做什么”。本文以已构建代码的证据回答这个问题：分级授权以及执行每一级的合约函数，十九个不变量及证明它们的测试，威胁模型，已知风险，以及各工具的结果。英文版：[docs/security/SELF_ASSESSMENT.md](../security/SELF_ASSESSMENT.md)。架构：[docs/zh-CN/ARCHITECTURE.md](ARCHITECTURE.md)。

快照：2026-10-18，在 D44 至 D75 之后、针对 F10、Web 推送和沙盒的安全审查（D80 至 D83）之后，以及红队测试、M18 演练和 Pyth 喂价（D86 至 D90）之后更新。M17 版本之后新构建的部分：带联盟控制台和临时评委沙盒的 Web 应用（M13）、小程序（M14）、智能体密钥轮换与所有者恢复（F10）以及国密冒烟测试（M15）、Base Sepolia 部署、实链运行脚本与红队测试套件（M16）、生产 compose 覆盖文件及其拒绝检查（M18）。红队测试已于 2026-10-18 针对本地栈运行，0 个攻击得逞（[第 9 节](#9-红队测试结果)）；M18 已在分叉上通过（D90）；2026-10-18 团队在 iPhone 上通过了小程序的绑定、SOTER Face ID 审批、重放被拒、冻结、解绑和中文界面（风险 10）。在本次提交时仍未完成：M16 关卡在 `docs/PROGRESS.md` 中尚未勾选（M12、M13、M15 和 M18 已于 2026-10-17 和 2026-10-18 通过），因为 Base Sepolia 上的实链证据运行（其证据见 `docs/EVIDENCE.md`）尚未结束；依赖它的行会注明（D85）。

## 1. 证据一览

| 检查 | 结果 | 位置 |
|---|---|---|
| Foundry，Base 合约 | 235 个单元、模糊与不变量测试通过（quick profile），另有 13 个在真实 Safe7579 上的 fork 测试（`make test-fork`，需要网络） | `contracts/base/test` |
| Foundry，FISCO 合约 | 30 个测试，另有 8 个针对 board 国密构建的测试（`FOUNDRY_PROFILE=sm`，D55） | `contracts/fisco/test`、`contracts/fisco/sm/test` |
| 模糊测试与不变量 | 里程碑 profile（`make test-contracts-full`）中每个模糊测试 10,000 次运行，不变量 256 x 64 次运行；每次提交时为 256 与 32 x 32 | `contracts/base/foundry.toml` |
| 行覆盖率，`MandateHook.sol` | **99.52 %（207 / 208）**；hook 连同其四个库 99.5 %（821 / 825）；目标 90 % | [第 7 节](#7-覆盖率) |
| Slither，Praetor 自有 Base 代码 | High 0，Medium 27（全部已解释），Low 52 | [slither.md](../security/slither.md) |
| Slither，内置（vendored）WeCross proxy | High 3，Medium 8，全部判定为不可利用；自 D49 起它与 `lib/` 一样被过滤，因此 **`make slither` 通过**（它同时分析 FISCO 合约） | [slither.md](../security/slither.md) |
| `pnpm audit --prod` | 4 个 high，7 个 moderate，2 个 low；每项均已评估，尚未升级任何依赖 | [deps.md](../security/deps.md) |
| gitleaks（完整历史） | 无泄露；由于 `scripts/checks/gitleaks.sh` 挂载了公共 git 目录，历史扫描在 git worktree 中同样有效 | [deps.md](../security/deps.md) |
| 集成与 e2e（流程 F1 至 F10） | F1 至 F9 在 M3 至 M11 的关卡中全部通过（`docs/PROGRESS.md`）。M12 关卡：在全新分叉上以 WeCross 为传输（`BRIDGE=wecross`），集成测试 16/16 个文件、e2e 41/41。M13 关卡：Web 应用的 Playwright 旅程 F1 至 F10 与沙盒用例（`apps/web/e2e`）15/15，34 张截图均经 axe 检查。M15 关卡：F10（`test/e2e/F10-rotation-recovery.test.ts`）3/3 以及 48 小时后的执行（`test/warp/F10-recovery-execute.test.ts`），均在全新分叉上。以上是 `docs/PROGRESS.md` 中记录的关卡结果；本文未重新运行（共享的本地栈正被占用） | `test/integration`，`test/e2e`，`test/warp`，`apps/web/e2e` |
| 生产环境拒绝（I13） | `scripts/deploy/prod-refusals.sh` 以 `PRAETOR_ENV=prod` 及各自的仅测试设置（模拟器证明、伪造的腾讯接口、伪 LLM）启动 bank、agent-signer、soter-attester、agent-runner 和 api，并期望每个服务都拒绝启动；由 `make rehearsal` 运行：在 2026-10-18 的 M18 演练中五个服务全部拒绝启动，同时 `compose.prod.yml` 上的冒烟测试 F1、F5、F8 16/16 通过（D90） | `scripts/deploy`，`test/infra/compose-prod.test.ts` |
| 红队（“N attacks, 0 executed”） | 本地栈，2026-10-18：脚本化运行 **85 attacks, 0 executed**；全局运行（共享状态）**3 attacks, 0 executed**；真实模型 **12 attacks, 0 executed**（3 个被系统拦截，9 个被模型拒绝）。早先运行中的发现已修复并重新测试（D86 至 D88） | [第 9 节](#9-红队测试结果)，[redteam.md](../security/redteam.md) |
| 渗透测试 | **Phase C**，报告写入 `docs/security/pentest.md` | [第 10 节](#10-渗透测试) |
| TEE 部署检查清单 | 列出当前已由代码强制的条目；结果**在部署之后（Phase C）** | [tee-checklist.md](../security/tee-checklist.md) |

复现：`make test`（守卫检查、gitleaks、类型检查、全部单元测试、Foundry quick profile）、`make test-contracts-full`、`make test-fork`、`make slither`、`pnpm audit --prod`，以及在本地栈启动后（`make up`）运行 `make test-int` 和 `make e2e`。

## 2. 分级授权

Praetor 账户的每一次执行都经过 `MandateHook.preCheck`（I1），无论由谁签名。hook 唯一的评估器 `DecisionLib.evaluate` 为每个调用返回一个原因和一个层级；`check()` 和 `checkBatch()` 以视图函数形式暴露同一个评估器，因此 `RefusalLog` 记录的拒绝总是带有 hook 计算出的原因（I11）。处处适用的经验法则：**收紧所需的签名少于放宽。**

| 层级 | 示例操作 | 验证合约函数 | 签名者 | 证明 |
|---|---|---|---|---|
| **T0 永不** | 被提示注入的智能体向被制裁地址支付 5,000 USDC；FROZEN 期间的任何调用；超过银行上限或硬上限；delegatecall、ETH value、未知目标或选择器；过期价格；滑点 | `MandateHook.preCheck` 以 `MandateRefused(reason, callHash)` 回滚；`RefusalLog.log` 记录 `check()` 给出的原因 | 无人：任何审批都不能解除 T0 原因 | `contracts/base/test/unit/MandateHookDecide.t.sol`（`test_A2_sanctionedPayee`、`test_A5_overHardCapPolicyOrBank`、`test_A6_bankDailyCapIsT0EvenWithApproval`、`test_approvalNeverLiftsFrozen`、`test_rule5_hiddenCalls`）；`test/invariant/HookInvariants.t.sol`（`invariant_I8_bankCapsNeverExceeded`）；`test/e2e/F5-agent-payment.test.ts`（"4-5: an injected 5,000 USDC payment to a sanctioned address is refused SANCTIONED"） |
| **T1 自主** | 在自动上限内向白名单收款人“Pay the café 12.50”；在区间内再平衡；到期的定期付款 | `AgentKeyValidator.validateUserOp`（智能体密钥，仅限 `execute`），然后 `MandateHook.preCheck`；定期付款：`StandingOrders.execute` 然后 `executeFromExecutor`，由 hook 的 executor 路径检查 | agent-signer TEE 中的智能体密钥；定期付款可由任何人触发 | `MandateHookDecide.t.sol`（`test_baselinePaymentIsAutonomous`、`test_rebalanceInsideTheBandsIsAutonomous`）；`MandateHookExecute.t.sol`（`test_allowedPaymentRecordsSpendAndEmitsDecision`、`test_executorPathSkipsTheT2GroupButNotT0`）；`test/fork/Safe7579Fork.t.sol`（`test_agentPaysAutonomouslyAndARefusalIsLoggedWithTheHooksReason`、`test_standingOrderPaysThroughExecuteFromExecutor`）；e2e F4、F5（"2:"）、F7 |
| **T2 人工** | 向 Café Lumen 支付 300（未知收款人，超过自动上限），或超过用户的预算、笔数、缓冲或再平衡限制 | `MandateHook.registerApproval(Tier2Approval, OwnerAuth)` 登记一个绑定到单个 `callHash` 的审批；下一次 `preCheck` 消耗它 | 所有者：通过 WebAuthn.sol 在链上验证的 passkey，或由活跃的 attester TEE 为该账户的微信绑定签发的 `SoterApproval` | `MandateHookOwner.t.sol`（`test_passkeyApprovalRegisters`、`test_soterApprovalNeedsPolicyBindingAndActiveAttester`、`test_soterCounterAndBinding`）；`MandateHookDecide.t.sol`（`test_T2ApprovalLiftsAndIsBoundToTheCall`、`test_oneApprovalCoversOneCallInABatch`）；`MandateHookExecute.t.sol`（`test_approvalIsConsumedOnce`）；`test/e2e/F6-approval.test.ts`（passkey、SOTER、重放的计数器） |
| **T3 所有者 + 银行** | 设置或修改授权委托（`SET_POLICY`），新增定期付款，绑定微信，设置或轮换智能体密钥，新增所有者 passkey（新设备），安装或移除模块 | `MandateHook.applyOwnerAction(OwnerAction, payload, OwnerAuth, bankSigs)`；模块变更随后还需要 `execute(self.installModule / uninstallModule)` 并带有已登记的 `moduleApprovals` 条目（D8） | 所有者 passkey，或对 `SET_POLICY`、`ADD_STANDING_ORDER`、`SET_AGENT_KEY` 和 `MODULE_CHANGE` 使用 SOTER（`LINK_WECHAT` 和 `SET_OWNER_KEY` 仅限 passkey），**以及**银行的 ECDSA 签名；银行仅在完成自身规则检查后联署（D26） | `MandateHookOwner.t.sol`（`test_setPolicyNeedsOwnerAndBank`、`test_setPolicyWithSoterAndBank`、`test_standingOrderAddNeedsBankCancelAlone`、`test_setAgentKeyOnlyTheBankVerifiedKey`、`test_setOwnerKeyPasskeyAndBankOnly`、`test_linkWechatIsPasskeyOnlyAndChecksTheProof`、`test_moduleChangeRegistersAModuleApproval`）；`Safe7579Fork.t.sol`（`test_I1_approvedHookRemovalSucceeds`）；`services/bank/test/cosign.test.ts`；`services/api/test/devices.test.ts`（"registers a second device for the signed-in owner and returns the key for SET_OWNER_KEY; it signs in once Base holds it"）；`services/api/test/rotation.test.ts`（"creates the key version after the one Base holds for the account"）；e2e F1（"14: SET_AGENT_KEY"）、F2、F3；F10（"3-5: rotate: ..."） |
| **T3- 仅所有者** | 撤销智能体密钥，暂停智能体（以及恢复所有者自己设置的暂停），移除收款人或商户，取消定期付款，解绑微信，取消待执行的恢复 | 不带银行签名的 `MandateHook.applyOwnerAction` | 所有者 passkey 或 SOTER | `MandateHookOwner.t.sol`（`test_pauseAndResumeAreOwnerAlone`、`test_removePayeeAndMerchantUpdatesThePolicyHash`、`test_linkWechatWithoutPolicyThenUnlinkAlone`、`test_ownerCancelsRecoveryAlone`）；银行拒绝联署这些类型（`cosign.test.ts`）；`services/api/test/mp-routes.test.ts`（"prepares the action over the binding on Base, and its success ends the mini program session"）；e2e F10（"1-2: stop my agent: REVOKE_AGENT_KEY by the owner alone; the key no longer validates; its AgentMandate is revoked"） |
| **恢复** | 所有者丢失了全部 passkey：银行自行重新 KYC，结果与密封的 PersonKYC 记录一致后，为新 passkey 安排恢复（D47） | `MandateHook.scheduleRecovery`（仅银行，仅 `SET_OWNER_KEY`），48 h 后任何人都可通过 `executeRecovery` 执行，它替换全部所有者密钥、清除微信绑定、使账户 epoch 递增并撤销智能体密钥；在此期间账户处于 RESTRICTED，任何剩余的 passkey 都可单独取消 | 银行（其 Base 签名密钥；交易由其 desk 账户发送） | `MandateHookOwner.t.sol`（`test_recoveryScheduledByBankExecutesAfter48h`、`test_ownerCancelsRecoveryAlone`、`test_recoveryOnlyForSetOwnerKey`）；`services/bank/test/recovery.test.ts`（"signs SET_OWNER_KEY for the new passkey with the bank key and schedules it on Base; tells the user itself"）；`services/api/test/devices.test.ts`（"registers the new passkey for the email, then starts the bank's re-KYC with it; status and execution are public"）；e2e F10（"6: recovery: a new passkey for the email and a matching re-KYC schedule it (RESTRICTED); a mismatching one does not; a remaining passkey cancels"）和 `test/warp/F10-recovery-execute.test.ts`（"6: scheduled after the matching re-KYC; 48 h later executeRecovery: only the new passkey signs in, the agent key is revoked"） |
| **T4 联盟** | 监管冻结（3 中 1），放宽回 ACTIVE（3 中 2），心跳（任意 1 个），制裁列入（1）与移除（2），司法辖区封禁（1）与解封（2），资产暂停（任意 1 个），上限、KYA、资产激活与 attester 激活（银行），attester 停用（任意 1 个），审计锚定（任意 2 个） | `MandateHook.applyStatus / applyHeartbeat / applySanctions / applyJurisdiction / applyAsset / applyCaps / applyKYA / applyAttester`、`Anchor.anchor`：对互不相同、按升序排列的成员签名者做 `ecrecover`，`nonce == stored + 1`（由 FISCO 分配），`block.timestamp <= deadline` | 成员的 Base 签名密钥（银行、监管方、运营方） | `MandateHookConsortium.t.sol`（22 个测试，例如 `test_oneMemberFreezesAnAccount`、`test_looseningNeedsTwoMembers`、`test_sameStatusCountsAsLoosening`、`test_sanctionsListOneDelistTwo`、`test_jurisdictionBlockOneUnblockTwo`、`test_assetActivationNeedsBankSuspensionAnyMember`、`test_attesterActivateBankDeactivateAny`、`test_capsNeedTheBank`、`test_kyaNeedsTheBank`）；`test/fuzz/HookFuzz.t.sol`（`testFuzz_I3_signerSets`、`testFuzz_I18_nonce`）；`Anchor.t.sol`；`contracts/fisco/test/Board.t.sol`、`Boards.t.sol`；`test/e2e/F9-governance.test.ts`（8 个测试） |

已构建代码中的确切阈值（`contracts/base/src/hook/ConsortiumLib.sol`）：只有当新状态严于已存储状态时，状态变更才算“收紧”；相同或更宽松的状态需要 2 个签名。当资产状态变得不那么严格、银行的最大权重提高或类型改变时，资产变更算作放宽。心跳只需任意一个成员签名，有效期至多一天（`MAX_HEARTBEAT_TTL`）。`Anchor` 接受任意两个成员；其中必须有银行，是运营方服务的策略（D41），而非合约规则。

已构建代码中的原因码：hook 按 spec 03 的决策顺序返回 spec 02 的原因。冻结协议中的两个码从不由 `check()` 返回：`TIER2_REQUIRED`（14）和 `TIER2_INVALID`（15）。无效的审批不会产生拒绝原因：`registerApproval` 和 `applyOwnerAction` 以自定义错误回滚（`BadOwnerAuth`、`BadSoter`、`DigestUsed`、`BadExpiry`、`SlotBusy`、`SoterNotEnabled`、`BankRequired`），因此不会登记任何内容，该笔支付仍以其原有的 T2 原因被拒绝（D65）。

## 3. 不变量及其证明测试

状态：**Proven（已证明）** = `make test` 中的自动化测试；**Fork** = 在真实 Safe7579 上的 Foundry fork 测试（`make test-fork`，需要网络）；**Gate（关卡）** = 在里程碑关卡中针对本地栈运行的集成或 e2e 测试；**Partial（部分）** = 陈述的一部分已证明，其余部分予以说明；**Not yet（尚未）** = 尚无自动化证明。

| # | 不变量 | 状态 | 证明 |
|---|---|---|---|
| I1 | 每一次执行都经过 `MandateHook`；Safe 原生所有者无法执行 | Fork、Proven、Gate | `Safe7579Fork.t.sol`：`test_I1_execTransactionAlwaysReverts`、`test_I1_rawUninstallRefusedByThePasskeyValidator`、`test_I1_uninstallThroughExecuteWithoutApprovalRefused`、`test_I1_approvedHookRemovalSucceeds`、`test_freshAccountRefusesEverything`。`MandateHookExecute.t.sol`：`test_moduleChangeNeedsAnApproval`、`test_innerModuleCallWithoutOuterApprovalRefused`、`test_executionModesOtherThanSingleAndBatchAreHidden`、`test_executorPathOnlyFromStandingOrders`。`NoOwner.t.sol`：`testFuzz_neverSigns`。`PasskeyValidator.t.sol`：`test_refusesRawModuleCalls`。`test/integration/bundler-base.test.ts`：两个 "I1:" 测试 |
| I2 | 默认拒绝：任何未建模的目标或选择器都被拒绝 | Proven | `HookFuzz.t.sol`：`testFuzz_I2_defaultDeny`、`testFuzz_I2_unknownSelectorsOnKnownContracts`、`testFuzz_nonCanonicalBatches`。`MandateHookDecide.t.sol`：`test_unknownTargetRefused`、`test_usdcSelectorsOutsideThePatternRefused`、`test_nonCanonicalTransferEncodingsRefused`、`test_metalTransfersAndOtherTokenSelectorsRefused`。`MandateHookExecute.t.sol`：`test_otherSelectorsValueAndShortDataAreHidden`、`test_malformedExecuteEncodingsAreHidden`、`test_nonCanonicalBatchIsHidden`、`test_selfCallInsideABatchIsHidden` |
| I3 | 联盟消息需要有效的成员签名，nonce = stored + 1，且在截止时间之前；收紧 1 个，放宽 2 个 | Proven、Gate | `MandateHookConsortium.t.sol`（全部 22 个测试，包括 `test_signerSetRules`、`test_otherDomainRefused`、`test_rejectsMalleableHighS`、`test_deadlinePassedRefused`）。`HookFuzz.t.sol`：`testFuzz_I3_signerSets`。`Anchor.t.sol`：`test_oneMemberIsNotEnough`、`test_nonMemberRefused`。FISCO `Board.t.sol`：`test_looseningNeedsTwoAndSignaturesAreSortedBySigner`、`test_duplicateSignerRefused`、`test_digestMatchesTheGoldenVector`。e2e F9（"5: loosening to ACTIVE needs two members"） |
| I4 | 心跳过期前未续期，即无自主操作 | Proven、Gate | `MandateHookDecide.t.sol`：`test_A8_staleHeartbeat`。`MandateHookConsortium.t.sol`：`test_heartbeatEpochAndTtl`。`services/operator/test/heartbeat.test.ts`。e2e F9（"6: without heartbeats autonomous actions become STALE_STATUS; human approvals still work"）。STALE_STATUS 是 T2 原因：如 spec 02 所述，人工审批仍可解除它 |
| I5 | 人工审批绑定到单个 `callHash`，一次性使用，会过期，并带有新的 nonce | Proven、Gate | `MandateHookOwner.t.sol`：`test_approvalReplayAndSlotRules`、`test_approvalExpiryWindow`、`test_approvalRefusesWrongPasskeyOrUnknownCredential`、`test_ownerActionDigestSingleUseAndExpiry`。`MandateHookExecute.t.sol`：`test_approvalIsConsumedOnce`。`HookFuzz.t.sol`：`testFuzz_I5_approvalReplay`。`services/mcp/test/app.test.ts`（"refuses a call without a live, unconsumed approval for its callHash, and a batch"：审批之后的重新提交只为该笔调用签名，D72）。e2e F6 |
| I6 | 每个绑定的 SOTER 计数器严格递增；绑定必须与账户的绑定一致 | Proven、Gate | `MandateHookOwner.t.sol`：`test_soterCounterAndBinding`、`test_soterRefusesWrongDigestAccountExpiryOrInactiveAttester`。`HookFuzz.t.sol`：`testFuzz_I6_soterCounters`。`services/soter-attester/test/attester.test.ts`（"refuses a result Tencent does not verify, a raw that is not the digest, a bad code, a far expiry"）。e2e F6（"failure: a replayed SOTER counter is refused on-chain"），F2（"failure: a SOTER result over another digest is refused by the attester"）。绑定和计数器在链上检查；attester 只检查 SOTER 结果是否签署了确切的摘要 |
| I7 | 智能体密钥只能发送 `execute`；永远不能修改规则、密钥或模块 | Proven、Fork、Gate | `AgentKeyValidator.t.sol`：`test_refusesInstallAndUninstallModule`、`test_refusesExecuteTargetingTheAccount`、`test_refusesOtherCallTypes`、`test_onlyHookSetsAndRevokes`。`Safe7579Fork.t.sol`：`test_I7_agentCannotChangeModulesEvenWithAnApproval`。`services/agent-signer/test/signer.test.ts`（"refuses another sender, a non-execute call, a call to the account itself, another chain or entry point"）。集成测试 `bundler-base.test.ts`（"I7: the agent key cannot change modules"） |
| I8 | 有效限额 = min（策略，银行上限）；即使有 T2 或 T3，银行上限也永不被突破 | Proven | `HookInvariants.t.sol`：`invariant_I8_bankCapsNeverExceeded`、`invariant_spentEqualsAllowedPayments`。`MandateHookDecide.t.sol`：`test_A5_overHardCapPolicyOrBank`、`test_A6_bankDailyCapIsT0EvenWithApproval`、`test_A6_missingCapsDenyByDefault`、`test_C6_bankMaxWeightIsT0`。`MandateHookExecute.t.sol`：`test_executorPathRefusesSwapsAndBankCaps`。e2e F3（"failure: a hard cap above the bank cap of the profile is refused"） |
| I9 | KYC 数据从不离开银行服务；MCP 和智能体从不接收个人信息（PII） | Proven、Gate | `services/bank/test/kyc.test.ts`（"round-trips and never contains the plaintext"，以及其状态 "has no PII" 的供应商路径测试）。`kyc-routes.test.ts`（"answers 409 to a replayed decision and never echoes personal data"）。集成测试 `bank-kyc.test.ts`（"the record at rest holds no plaintext personal data"、"I9: no service log contains the seeded personal data"，KYC 模拟服务不保留任何图片）。e2e F5（"I9: no tool output carries KYC data"）。KYC 数据以 AES-256-GCM（`KYC_ENC_KEY`）密封；MCP 工具在构造上不读取任何 KYC 数据 |
| I10 | 密钥从不进入 git；TEE 密钥从不离开飞地 | Proven、Partial | `test/infra/repo.test.ts`（"secrets stay out of git (I10)"：忽略 `.env` 和密钥文件，含密钥的目录不进入 Docker 构建上下文，`make test` 中运行 gitleaks）。`scripts/checks/gitleaks.sh`。agent-signer：没有任何路由返回密钥材料（`signer.test.ts`，"never returns key material"）；密钥只在 TEE 内通过 `getKey` 存在。部分：TEE 这一半在 dstack 模拟器上得到证明；在 Phala 上它是部署检查（tee-checklist） |
| I11 | `RefusalLog` 中的拒绝原因由 hook 的 `check()` 计算 | Proven、Gate | `RefusalLog.t.sol`：`test_logsTheReasonTheHookComputes`、`test_refusesToLogAnAllowedCall`、`testFuzz_reasonAlwaysMatchesCheck`。集成测试 `bundler-base.test.ts`（"submits a refused op for evidence and logs the reason the hook computes (I11)"）。e2e F5 |
| I12 | 所有算术都经过检查；溢出即拒绝（`check()` 从不回滚） | Proven | `MandateHookDecide.t.sol`：`testFuzz_checkNeverReverts`、`testFuzz_checkNeverRevertsOnKnownTargets`、`testFuzz_checkBatchNeverReverts`、`test_A1_invalidAmount`、`test_C1_invalidAmount`。`MandateHookConsortium.t.sol`：`test_capsAbove2pow128Refused`。`packages/protocol/test/hash.test.ts`（"refuses amounts above 2^128 before any arithmetic"、"refuses a price at or above 2^128 or more than 36 decimals"），D17 |
| I13 | 生产配置拒绝模拟器证明和调试模式的 TEE | Partial | `packages/config/test/config.test.ts`（"prod refuses the simulator, the fake Tencent, the fork, default passwords and an unthrottled sandbox"、"only prod triggers the prod refusals"）。`services/agent-signer/test/config.test.ts`、`services/soter-attester/test/config.test.ts`、`services/bank/test/flags.test.ts`（各为 "prod refuses simulator ..."）。`services/bank/test/attestation.test.ts`（"phala mode: needs the verifier to accept and the compose hash on the allowlist"）。`services/api/test/wechat.test.ts`（"prod refuses the fake and any WeChat base but the official one"）。`test/infra/compose-prod.test.ts`（"never starts the scripted model"、"has a rehearsal target that runs the smoke suite and the prod refusals"）；`scripts/deploy/prod-refusals.sh` 在生产 compose 中检查五个服务的拒绝（`make rehearsal`，已在 M18 演练中通过，D90）。尚未：调试模式的拒绝依赖 Phala 的验证器，在部署时检查（Phase C）；各服务的缺口见[第 5 节](#5-已知风险) |
| I14 | 处于 FROZEN 时，没有任何价值流出（支付、兑换、出款、定期付款） | Proven、Gate | `HookInvariants.t.sol`：`invariant_I14_nothingLeavesWhileFrozen`。`MandateHookDecide.t.sol`：`test_rule1_frozenWinsOverEverything`、`test_approvalNeverLiftsFrozen`。`MandateHookExecute.t.sol`：`test_frozenBlocksModuleChanges`（D19）。`StandingOrders.t.sol`：`test_hookStillRefusesFrozenSanctionsJurisdictionPartnerAndCaps`。e2e F9（"3: the next agent action is refused FROZEN on-chain (I14)"） |
| I15 | 再平衡结束时，资产永远不会处于其区间之外，除非它更接近目标 | Proven、Gate | `HookInvariants.t.sol`：`invariant_I15_bands`。`HookFuzz.t.sol`：`testFuzz_I15_projectionMatchesOutcome`。`MandateHookExecute.t.sol`：`test_postCheckEnforcesBandsOnRealBalances`、`test_postCheckCatchesABreachTheProjectionMissed`、`test_postCheckSkipsTheBandRuleWhenAHumanApprovedTheBreach`。`MandateHookDecide.t.sol`：`test_C10_bandBreachNeedsAHuman`。e2e F4 |
| I16 | hook 之外没有签名路径：不存在有效的 ERC-1271 签名 | Fork、Proven | `Safe7579Fork.t.sol`：`test_I16_usdcPermitAndAuthorizationWithAccountSignaturesFail`。`AgentKeyValidator.t.sol` 和 `PasskeyValidator.t.sol`：`testFuzz_erc1271AlwaysInvalid`。`NoOwner.t.sol`：`testFuzz_neverSigns`。hook 还拒绝 USDC 的 `permit`、`transferWithAuthorization`、`receiveWithAuthorization` 和 `transferFrom`（D10，`test_usdcSelectorsOutsideThePatternRefused`） |
| I17 | Safe7579 adapter 的每个非 view 选择器要么经过 hook 包裹，要么不可达 | Fork | `Safe7579Fork.t.sol`：`test_I17_outsidersCannotReachAnyNonViewEntryPoint`、`test_I17_ourValidatorsRefuseEveryOtherSelector` |
| I18 | 一条联盟消息无法阻塞后续消息（nonce = stored + 1） | Proven | `MandateHookConsortium.t.sol`：`test_nonceMustBeStoredPlusOne`。`HookFuzz.t.sol`：`testFuzz_I18_nonce`。`Anchor.t.sol`：`test_sequenceAndDeadline`。FISCO `Board.t.sol`：`test_openAllocatesIdNonceAndFiscoRef`、`test_reissueAnUndeliveredExpiredMessageWithTheSameNonce`、`test_reissueRefusedWhenDeliveredNotExpiredOrSuperseded`（D25） |
| I19 | Base 上没有个人数据：只有地址、金额和哈希 | **Not yet**（仅凭设计） | 目前尚无测试扫描 Base 的 calldata 和事件；针对实链测试套件的扫描计划在 M16 中完成，本次提交时尚未构建。设计上：收款人是地址，商户是 `merchantRef = keccak256(merchantId)`，出款引用是哈希，标签保存在 api 和 mcp 数据库中。按已构建代码，Base 还承载每个账户的 KYA 属性（kycLevel、riskProfile、两个字母的司法辖区）以及 ERC-3643 身份的国家代码，这与 spec 02 和 03 的定义一致（D69） |

## 4. 威胁模型

依据 spec 08，并按已构建代码更新。

| 攻击者 | 能做什么 | 已构建的控制措施 | 已构建代码中的缺口 |
|---|---|---|---|
| 提示注入（商户文本、聊天、收款人名称、工具结果） | 让 LLM 以错误参数调用工具 | 没有任何 MCP 工具接收账户参数（账户来自 bearer）；hook 的默认拒绝、制裁、上限和收款人列表；任何异常都属于 T2；OpenCode 的内置工具被禁用（不提供）或由 agent-runner 拒绝（D15、D86、D88）。测试：e2e F5（"I9"、"the built-in tools are locked"），`services/agent-runner/test/runner.test.ts`。2026-10-18 的红队第 1 项：12 个提示注入用例，分别以脚本化模型和真实模型运行，0 个得逞（[第 9 节](#9-红队测试结果)） | 留出的红队用例尚未运行（MANUAL 7.1） |
| 被攻陷的后端（api、scheduler、bundler） | 扣留、延迟、刷量、向用户展示错误信息 | 每项权限都是在链上验证的签名；被拒绝的操作有速率限制（每账户每天 20 次，`BUNDLER_MAX_REFUSED_PER_DAY`）；bundler 只向五个白名单合约发送普通交易；成员服务自行验证员工 passkey 断言（D24）；心跳故障安全机制。所见即所签：在 passkey 签名之前，Web 应用重新计算 Tier2Approval 摘要以及每个所有者操作的摘要、类型、账户和载荷哈希（D46；`apps/web/src/lib/web.test.ts`："signs an owner action only when its digest, kind, account and payload hash are what the page asked for"、"signs a policy only when the payload is the policy on the page"）；在 SOTER 签名之前，小程序重新计算 call hash 和摘要，并拒绝伪装成绑定的其他所有者操作（D52；`apps/miniprogram/test/verify.test.mjs`："refuses a digest that does not match the shown request"、"refuses another owner action shown as a link (e.g. CANCEL_RECOVERY, which SOTER can sign)"）；mcp 只重新提交在 hook 上存在有效审批的调用（D72）；Web 应用从浏览器自身的注册结果读取新设备的密钥，并且只为页面显示的智能体密钥签署授权委托草稿（D83；`apps/web/src/lib/devices.test.ts`、`apps/web/src/lib/agent.test.ts`） | 微信绑定确认、部署 userOp 和控制台提案仍按 api 返回的内容签名（风险 22）；恢复用的通行密钥由 api 转交银行，恢复状态也由 api 转发（风险 31）；agent-runner 的 `INTERNAL_TOKEN_MCP` 可为任意账户签发智能体 bearer（风险 19） |
| 被攻陷的 mcp（`sign-userop` 的唯一调用方） | 在 T1 授权委托内行事，如同泄露的智能体密钥 | hook 的边界和银行上限；agent-signer 将 `sign-userop` 限制为每账户每小时 120 次，并拒绝除发往其他目标、链 84532 上的 `execute` 之外的一切；所有者撤销（T3-）；联盟冻结 | 签名器的速率限制保存在内存中（重启后重置） |
| 被攻陷的 WeCross 路由器或中继 | 丢弃或延迟联盟消息 | 由 hook 验证的成员签名、nonce 和截止时间；静默使智能体变为 RESTRICTED（STALE_STATUS）；中继的看门狗会在 `BRIDGE_WATCHDOG_S` 内投递 WeCross 未投递的消息（D42） | WeCross 1.4.0 的说明见 [wecross.md](../security/wecross.md)（风险 18） |
| 泄露的智能体密钥或被攻陷的智能体 TEE | 在授权委托内行事 | hook 边界和银行上限；所有者可单独撤销；联盟可冻结；所有者可轮换到下一个密钥版本并获得新的 KYA，此后旧密钥不再通过验证，银行撤销其 AgentMandate（F10，D47；`services/api/test/routes.test.ts`："asks the bank to revoke the mandates of agent keys Base dropped, after a revoke or a new key lands"；mcp 向 agent-signer 请求 Base 上持有的那把密钥，`services/mcp/test/ports.test.ts`："asks the signer for the key that is the account's agent key on-chain (F10: after a rotation)"） | 风险 1。轮换仍在同一个 TEE 内：被攻陷的飞地可以派生每一个版本 |
| 滥用恢复流程（知道所有者邮箱和身份信息的人） | 让所有者的 passkey 被替换 | 只有银行能安排恢复，且须其向 KYC 提供方重新 KYC 的结果与密封的 PersonKYC 记录（姓名、出生日期、国籍、证件号码）一致；账户在 48 小时内处于 RESTRICTED，任何剩余的 passkey 都可单独取消；新 passkey 只有在 Base 持有它之后才能登录（`devices.test.ts`、`recovery.test.ts`、e2e F10 第 6 步） | 风险 31 |
| 被攻陷的 attester 密钥 | 为每个启用 SOTER 的账户签发 SOTER 审批，T2 支付最高可达各自的硬上限 | 银行上限仍为 T0；审批在一小时内过期（`MAX_TTL`）；任意一个成员即可停用 attester（`test_attesterActivateBankDeactivateAny`）；除非策略设置了 `soterEnabled`，否则 SOTER 关闭 | 风险 14 |
| 仅凭腾讯错误的 `is_ok` | 若没有来自已绑定手机、针对确切摘要的 SOTER 签名，则什么也做不了 | attester 拒绝 `raw` 不等于摘要的结果（`attester.test.ts`）；hook 检查绑定和计数器 | 风险 2 |
| 被盗的手机 | 以用户身份审批 | 手机生物识别；所有者可单独解绑微信（T3-）；银行可通过联盟冻结 | |
| 一个恶意的成员密钥 | 冻结或限制（安全方向），列入制裁，暂停资产 | 放宽需要两个成员；每项决定都是一个 FISCO 提案，其签名者记录在审计轨迹中 | |
| 重放旧消息或旧审批 | 重新应用旧状态或旧审批 | nonce（stored + 1）、截止时间、一次性摘要（`usedDigest`）、SOTER 计数器、恢复时重置的 epoch | |
| 被攻陷的预言机喂价方 | 推送错误价格 | 每次更新至多 25 %（`MAX_DEVIATION_BPS`），过期检查（`maxPriceAge`，4 天），滑点界限，银行的最大权重（T0），DEMO 价格带有标记 | 风险 6 |
| Web 攻击者 | XSS、CSRF、会话窃取、对 MCP 的 OAuth 滥用 | `HttpOnly`、`SameSite=Lax` 会话 cookie（https 下带 `Secure`）；每个改变状态的 api 请求都需要 CSRF token；OAuth 2.1 仅允许 PKCE S256，精确匹配的重定向 URI，一次性授权码，刷新令牌轮换并按族撤销，令牌仅以哈希存储（`services/mcp/test/oauth.test.ts`，28 个用例）；Web 推送消息为每个浏览器单独加密（RFC 8291），并用 Praetor 的 VAPID 密钥签名（RFC 8292），只发往 https 端点（`services/notifier/test/webpush.test.ts`："posts an aes128gcm-encrypted payload with a VAPID authorization to every subscription of the account"；`services/api/test/routes.test.ts`："refuses a subscription whose endpoint is not https"） | 自 D71 起：Caddy 提供严格的 CSP（脚本仅限本站、禁止嵌入、禁止 object）、HSTS、nosniff 与 no-referrer；api 拒绝来自其他 Origin 的写请求；登录、开户、恢复和小程序登录按客户端限流（`services/api/test/hardening.test.ts`、`test/infra/caddy.test.ts`）。自 D82 起：Web 推送只发往浏览器的推送服务，每个账户最多十个，不跟随重定向（`packages/protocol/test/push.test.ts`、`services/notifier/test/webpush.test.ts`），通知链接只打开本站页面（`apps/web/src/lib/sw.test.ts`），任何路由都不能被嵌入框架。剩余：见风险 21 |
| 读取日志的内部人员 | 获取个人信息 | KYC 数据密封在银行数据库中；状态响应不含个人信息；bundler 和成员服务在日志中隐去 authorization 头；集成测试套件中的 I9 日志扫描 | api 保存注册邮箱（不是 KYC 数据） |

## 5. 已知风险

第 1 至 17 项是 spec 08 的列表，已按构建结果更新；第 18 项及之后是构建过程中新增、在 M17 中、在文档更新（D85）中或在 2026-10-18 的安全审查（D80 至 D83）中发现的。

1. **智能体密钥。** 被攻陷的智能体 TEE 或泄露的智能体密钥可以在授权委托内行事，直到所有者撤销或轮换它（F10），或联盟冻结账户。受 hook 和银行上限约束。
2. **对 SOTER 的信任。** SOTER 审批信任腾讯未签名的 `is_ok` 以及 attester 的代码。受绑定、计数器、一小时过期、硬上限和银行上限约束。
3. **演示联盟由一个团队运营。** 在生产环境中，银行、监管方和运营方是拥有各自 HSM 的独立机构。
4. **无储备支撑的代币。** tXAU 和 tXAG 是演示代币；生产环境需要受监管的托管方并提供储备证明。
5. **模拟的出款。** 出款合作方以及支付宝 Alipay+ 和微信支付网关都是已标注的模拟服务（出款合作方针对模拟网关运行真实的 `ant-intl-alipayplus-mcp` 客户端）。生产环境需要持牌的支付服务商；稳定币出款仅限获得许可的地区，绝不面向中国大陆居民（`JURISDICTION_BLOCKED`）。
6. **预言机喂价方。** 单一密钥，每次更新至多变动 25 %。只有同时设置了 `PYTH_API_KEY` 且 `CHAIN_MODE=live` 时，它才读取 Pyth Hermes（每 5 分钟一次请求，D89）；在分叉上或没有该密钥时，喂价方推送标记为 DEMO 的预设价格（D13，BLOCKERS B2），且没有任何服务在生产环境中拒绝 DEMO 模式。
7. **RefusalLog 的关联。** `Refused` 记录与其 userOpHash 之间的关联是上报者的声明；原因则不是。bundler 只为在其预检中被拒绝、随后在链上失败的操作写入 RefusalLog。
8. **WeCross。** WeCross 1.4.0 上游已不再维护；EVM stub 是新代码（`wecross/evm-stub`，JUnit 向量与 viem 对照检查）。
9. **冻结也会阻止所有者。** 联盟冻结也会阻止所有者自己的支付和模块变更（D19）：这是设计上的受监管账户。
10. **小程序。** 小程序在测试账号上以调试模式运行；正式发布需要注册公司并完成 ICP 备案。在 M14 中构建。2026-10-18 团队在 iPhone 上用微信测试账号、通过 `make tunnel` 连接本地分叉进行了测试（MANUAL 第 5 节）：微信绑定、SOTER Face ID 审批（手机与 Web 应用显示相同的摘要）、重放的审批在链上被拒（DigestUsed）、监管冻结（从 FISCO 到 Base 6.3 秒；放宽 7.5 秒）、解绑和中文界面均已通过。未测试：Android 指纹（微信拒绝了第二部手机）；手机上的 Web 推送和沙盒页面尚未经人工测试。
11. **30 天周期。** 月度预算使用 `block.timestamp / 30 days`，而不是自然月：跨越边界时最多可能出现两个月度预算。
12. **ERC-3643 代理角色。** 银行的代币代理密钥可以强制转移或销毁任何持有人的 tXAU 和 tXAG（该标准的追回权力），这在 hook 之外（`Tokens.t.sol`，`test_agentForcedTransferBurnAndRecovery`）。
13. **被攻陷的 mcp。** mcp 是唯一允许调用 `sign-userop` 的服务；一旦被攻陷，它可在 T1 授权委托内行事。另见第 19 项。
14. **被攻陷的 attester 密钥。** 在任意一个成员将其停用之前，它可以为每个启用 SOTER 的账户批准 T2 支付。
15. **出块节点。** 演示中运营方运行 4 个 FISCO 出块节点中的 2 个，可以使联盟链停摆；生产环境中每个成员拥有自己的出块节点，并增加第四个成员。
16. **iOS 上的 SOTER 计数器。** 如果计数器在 iOS 上不递增，hook 的 `soterCounterStrict`（不可变的构造函数标志，通过 `SOTER_COUNTER_STRICT=1` 默认为 true）必须以 false 部署；由于每个审批的摘要只能使用一次，重放仍然不可能（在团队的 iPhone 上，重放的审批在链上以 DigestUsed 被拒，见风险 10）。
17. **WeIdentity REST** 是托管式且无认证的；它运行在独立的 `identity` 网络上，只有银行、MySQL 和一个 FISCO 节点加入（D29，`test/infra/compose.test.ts`）。
18. **WeCross 传输说明**（[wecross.md](../security/wecross.md)）：一个无法投递的请求可能阻塞 hub 队列（看门狗不依赖它）；两个 hub setter 没有访问控制；路由器在失败时会把链账户的私钥写入日志（只保存在主机或 CVM 上）；路由器 RPC 在 Docker 网络上是明文 HTTP；在 `BRIDGE=wecross` 模式下，bridge-relayer 持有 WeCross 路由器的 FISCO 密钥（D42）。
19. **可触达智能体密钥的内部令牌。** mcp 的 `POST /internal/resubmit`（在人工审批之后使用）受 `INTERNAL_TOKEN_API` 保护，api、notifier 和 mcp 共享该令牌。自 D72 起，它只为在 hook 上存在有效且未被消耗的审批的单笔调用签名（`services/mcp/test/app.test.ts`），因此该令牌只能就所有者已批准的调用触达智能体密钥。agent-runner 持有 `INTERNAL_TOKEN_MCP`，可为任意账户签发智能体 bearer：被攻陷的 agent-runner 可以在每个账户的 T1 授权委托内行事，如同被攻陷的 mcp。hook 仍约束每一个调用。
20. **共享的内部令牌。** `INTERNAL_TOKEN_MEMBERS` 由 api 和三个成员服务共享，`INTERNAL_TOKEN_BUNDLER` 由每个 bundler 调用方共享，`SESSION_SECRET` 由 api 和 mcp 共享。联盟签名仍需要员工针对确切摘要的 passkey 断言，但有四个自动的、经规则检查的签名例外：运营方的心跳，银行在自身检查后的 KYA，银行在规则检查后的所有者操作联署，以及银行在重新计算链后的锚定联署（D24、D26、D41）。F10 在联盟 board 之外增加了第五个自动的银行签名：恢复流程中的 `SET_OWNER_KEY`，只有在银行重新 KYC 的结果与密封记录一致后才会签署并发送（`scheduleRecovery`）（D47；受 48 小时延迟、其间的 RESTRICTED 状态以及所有者取消的约束，见风险 31）。
21. **已构建代码中的 Web 加固情况。** 自 D70 和 D71 起已完成：Caddy 提供 CSP 与安全响应头，api 对状态变更请求检查 Origin，公开的认证接口按客户端限流，控制台的账户列表需要工作人员会话。自 D82 起：推送订阅仅限浏览器推送服务且每个账户最多十个，notifier 不跟随重定向，点击通知只打开本站页面，每个路由都发送 `X-Frame-Options: DENY`（`packages/protocol/test/push.test.ts`、`services/notifier/test/webpush.test.ts`、`apps/web/src/lib/sw.test.ts`）。剩余：成员服务与 KYC 模拟服务没有限流（仅在内部网络）；限流计数保存在进程内存中，并以 Caddy 看到的地址为键，在 `make tunnel` 或 TLS 直通网关之后所有人共用一个网关地址（沙盒水龙头的按客户端限制也是如此）；api 中待用的 WebAuthn 挑战从不清理，只受限流约束。
22. **所见即所签。** Web 应用在 passkey 签名前根据请求的原像重新计算 Tier2Approval 摘要；自 D46 起，它还会重新计算每个所有者操作的摘要，核对其类型、账户与载荷哈希，并对策略、智能体密钥、新通行密钥、撤销和取消恢复，根据页面所显示的内容重建载荷。在 D83 之前，页面显示的新通行密钥来自 api 的应答，被攻陷的 api 可以让所有者为 api 自己的密钥签署 SET_OWNER_KEY（银行联署该操作时不检查密钥）；现在页面从浏览器自身的注册结果读取密钥并拒绝其他密钥（`apps/web/src/lib/devices.test.ts`），并且只为页面显示的智能体密钥签署授权委托草稿（`apps/web/src/lib/agent.test.ts`）。仍按 api 返回内容签名的有：微信绑定确认、账户的部署 userOp 以及控制台提案（成员服务会自行从 FISCO 读取提案摘要并验证工作人员的断言）。
23. **员工 WebAuthn 细节。** 成员服务接受 high-s 的 P-256 员工签名，且不检查签名计数器。可塑性不等于伪造，且挑战只能使用一次；影响较低。
24. **内存中的状态。** 员工会话和挑战、银行的报价 nonce、微信绑定会话、agent-signer 的速率限制、api 在 `/agent/rotate` 与授权委托草稿之间保存的新智能体密钥，以及沙盒水龙头已注资的账户和按客户端的计数都保存在内存中，重启后重置。
25. **生产环境的拒绝按服务分别实现。** `packages/config` 拒绝模拟器证明、伪造的腾讯接口、fork、默认密码以及无节流的沙盒，但只有 bundler、bridge-relayer 和成员服务加载它；agent-signer、soter-attester、银行、agent-runner 和 api 各自实现检查（模拟器、伪造的腾讯接口、微信 API 地址、伪 LLM；api 拒绝伪造的腾讯接口以及官方之外的任何微信 API 地址，`services/api/test/wechat.test.ts`）；oracle-feeder 的 DEMO 模式不会被拒绝。沙盒水龙头位于 api 中，而 api 不加载 `packages/config`：它把每个客户端的充值次数限制为 `SANDBOX_RATE_LIMIT_PER_HOUR`（默认 3），并且只在 fork 上铸币，因此在线上 Base 拒绝（`services/api/test/sandbox.test.ts`："limits funding per client address per hour"、"exists only when the sandbox is enabled, and mints only on the fork"），每个账户一次；但任何人都能创建账户（每个客户端每分钟 60 次注册），耐心的访客仍可铸造 fork 上的 USDC 并买空 fork 柜台的 tXAU 和 tXAG。`scripts/deploy/prod-refusals.sh` 在生产 compose 中检查五个服务的拒绝（已在 M18 演练中通过，D90）。
26. **KYC 路径。** EUDI 路径信任欧盟验证器后端对凭证签名的验证，结果为 kycLevel 1 且不做姓名筛查（D30）；供应商 HMAC 覆盖请求体但不含时间戳（重放由会话状态机阻止）；KYC 供应商是已标注的模拟服务，其决定总是 "approved"（银行仍会检查活体、年龄、制裁和司法辖区）。恢复时的重新 KYC 只比较输入的姓名、出生日期、国籍和证件号码与密封记录（不比较照片），因此在模拟服务下，知道这四个字段的任何人都能安排一次恢复：所有者会立即收到通知（D81），任何剩余的通行密钥都可在 48 小时内取消；每次取消后再次安排会使账户保持 RESTRICTED。仅通过 EUDI 验证的用户无法恢复（重新 KYC 使用供应商流程）。
27. **Base 上的假名属性。** KYA 证明把每个账户的 kycLevel、riskProfile 和两个字母的司法辖区放到 Base 上，ERC-3643 身份注册表还保存国家代码（D69）。
28. **USDC 被隐式批准**（D21）：联盟无法下架 USDC 本身；适用 Circle 自身的控制。
29. **流程。** 自 D49 起 `make slither` 通过，因为它像 `lib/` 一样过滤内置的 WeCross proxy；该 proxy 的发现在 [slither.md](../security/slither.md) 中逐一判定，而不作为关卡。M17 中发现的 gitleaks worktree 问题已修复（脚本挂载了公共 git 目录）。[deps.md](../security/deps.md) 中的依赖公告尚未升级。
30. **默认 profile 中的仅测试服务。** 脚本化的伪 LLM 随 `agent` profile 启动；当 `PRAETOR_ENV=prod` 时 agent-runner 拒绝 `FAKE_LLM_URL`，因此生产部署必须保持其为空。`infra/compose.prod.yml` 把伪 LLM 移到 `test` profile，因此生产 compose 从不启动它。
31. **已构建的恢复流程（F10）。** KYC 供应商是已标注的模拟服务，总是批准，重新 KYC 只比较输入的字段（风险 26），因此在演示中，任何知道所有者邮箱以及密封记录中四个身份字段的人都可以安排一次恢复；所有者的保护是 48 小时延迟、其间账户处于 RESTRICTED，以及任何剩余 passkey 都可以取消。银行的恢复通知发往其自身的日志接收端（D13）；自 D81 起，notifier 还会把每个 `RecoveryScheduled` 推送到所有者的设备，说明密钥何时被替换以及如何取消（`services/notifier/test/notifier.test.ts`），所有者也可在 Web 应用的设置页以及 RESTRICTED 状态中看到待执行的恢复。知道邮箱的陌生人每小时最多只能为该用户添加五个待定的恢复 passkey（D80），它们从不计入设备上限。恢复需要由 KYC 提供方签发的 PersonKYC：通过 EUDI 钱包开户的所有者无法恢复（银行拒绝）。执行之后旧审批作废（新的 epoch），微信绑定被清除，智能体密钥被撤销，因此所有者需要重新安装智能体密钥（`SET_AGENT_KEY`，所有者与银行）；恢复之前打开的小程序会话在下一次请求时即结束，因为 Base 已不再持有其绑定（D81，`services/api/test/mp-session.test.ts`）。经被攻陷的 api：恢复用的通行密钥只能经 api 送达银行，恢复状态也只能经 api 送达 Web 应用。被攻陷的 api 可以在用户进行重新 KYC 时把自己的密钥交给银行，并在设置页面隐藏待处理的恢复；丢失全部通行密钥的用户无法取消。同样，恢复的 KYC 链接是持有即可使用的凭证，供应商页面也不会说明这是一次恢复：任何人都可以用受害者的邮箱发起恢复，再把该链接发给受害者，受害者一旦完成核验，安排的就是陌生人的密钥。约束：48 小时延迟、notifier 的推送（独立服务）、银行自己的通知，以及任一成员发起的冻结。
32. **以邮箱作为恢复入口。** 注册邮箱未经验证。恢复把邮箱解析为其第一个账户（D80），因此谁抢先用他人的邮箱注册，谁就占据了该恢复入口。`/api/recover/options` 会暴露某邮箱是否有账户（404 或 200，按客户端限流，D71）并返回其用户 id，凭此 `/api/recover/:userId` 可显示恢复状态。
33. **会话比密钥活得久。** Web 会话是无状态的 12 小时 cookie：恢复或丢失、替换通行密钥后，它在过期前仍然有效。任何权限仍需要通行密钥断言或智能体的授权委托，而恢复会撤销智能体密钥。自 D81 起小程序会话会立即结束。
34. **`make tunnel`。** 快速隧道把本地栈（fork、伪造的腾讯接口、KYC 模拟服务）暴露给任何拿到其 trycloudflare 地址的人：手机测试结束后请停止它（`make tunnel-stop`）。在生产环境中，Caddyfile 的明文 HTTP 隧道站点会响应发送其占位主机名的客户端；它通过 HTTP 提供同一个应用，在那里 Secure cookie 和通行密钥都不起作用。

## 6. 静态分析

完整报告：[slither.md](../security/slither.md)。Praetor 自有的 Base 合约：**High 0，Medium 27，Low 52**，自 M2 以来未变；每个 Medium 都有解释（零初始化的局部变量、有意忽略的返回值、非余额相等比较）。内置的 WeCross proxy（M12）新增 High 3、Medium 8、Low 11，逐一判定为不可利用：该 proxy 不持有任何权限，它承载的每条消息都由 hook 验证。它曾使 `make slither` 在 M17 时以退出码 255 结束（D66）；自 D49 起该关卡像 `lib/` 一样过滤 `src/vendor/` 并通过，判定结果保留在 slither.md 中。FISCO 合约现已纳入同一关卡：High 0，Medium 5（同样是已解释的类别），Low 13。未运行 `forge lint`。

## 7. 覆盖率

在 `contracts/base` 中运行 `FOUNDRY_PROFILE=quick forge coverage --no-match-path 'test/fork/*' --report summary`（排除 fork 测试，因为它们需要网络；forge 在覆盖率统计时禁用优化器和 `via_ir`，因此需要 `via_ir` 的内置 proxy 没有对应行）。目标：MandateHook 行覆盖率 90 %（spec 08）。

| 源文件 | 行 | 语句 | 分支 | 函数 |
|---|---|---|---|---|
| `MandateHook.sol` | **99.52 %（207/208）** | 99.59 %（242/243） | 100 %（38/38） | 100 %（53/53） |
| `hook/DecisionLib.sol` | 99.66 %（295/296） | 96.41 %（510/529） | 82.83 %（82/99） | 100 %（31/31） |
| `hook/OwnerLib.sol` | 99.43 %（175/176） | 95.14 %（274/288） | 81.54 %（53/65） | 100 %（15/15） |
| `hook/ConsortiumLib.sol` | 100 %（97/97） | 97.76 %（131/134） | 80.00 %（12/15） | 100 %（13/13） |
| `hook/PostCheckLib.sol` | 97.92 %（47/48） | 97.83 %（90/92） | 86.67 %（13/15） | 100 %（5/5） |
| **hook 连同其库** | **99.52 %（821/825）** | | | |
| `AgentKeyValidator.sol` | 100 %（44/44） | 98.18 % | 88.89 % | 100 % |
| `PasskeyValidator.sol` | 93.65 %（59/63） | 93.51 % | 93.33 % | 87.50 % |
| `RefusalLog.sol`、`Anchor.sol`、`NoOwner.sol`、`PayoutRail.sol`、`PraetorPaymaster.sol`、`PriceOracle.sol`、`TreasuryDesk.sol`、`WeCrossInbox.sol` | 各 100 % | | | |
| `StandingOrders.sol` | 97.06 %（33/34） | 100 % | 100 % | 87.50 % |
| `tokens/PraetorToken.sol` | 95.52 %（64/67） | 91.55 % | 71.43 % | 94.12 % |
| `tokens/IdentityRegistry.sol` | 85.00 %（17/20） | 84.21 % | 50.00 % | 87.50 % |

目标已达成。hook 各库的分支覆盖率（80 % 至 87 %）低于行覆盖率；本文未逐一审查未覆盖的分支。

## 8. 依赖、密钥与许可证

- **依赖审计**（[deps.md](../security/deps.md)）：`pnpm audit --prod` 报告 4 个 high、7 个 moderate 和 2 个 low 公告。按实际用法不可达：MCP SDK 的 OAuth 客户端（我们使用 stdio）、drizzle 标识符（静态）、body-parser 限制、react-router（无 SSR，固定路由）、uuid。低风险：mysql2（需要内部网络上存在恶意 MySQL 服务器）。需要升级：express 的 qs 和 path-to-regexp（公开路由上的 DoS）。Java 部分的 OWASP dependency-check 以及镜像扫描是未完成事项。
- **密钥**：`.env`（mode 600）被 git 忽略，密钥只追加不覆盖（`pnpm keys`），服务从不记录密钥值；gitleaks 在 `make test` 中运行，在本次提交时本分支的历史中未发现泄露。
- **GPL 边界**（[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md)）：`contracts/` 和 `packages/` 中没有 GPL 或 LGPL 源码（除 Apache-2.0 的内置 proxy 外，每个 Solidity 文件都是 `UNLICENSED`）；编译进 Base 合约的 51 个源文件中，26 个为 `UNLICENSED`，24 个为 MIT，1 个为 Apache-2.0。GPL 合约（Safe7579、launchpad、registry、EntryPoint）和 LGPL 的 Safe 仅以已部署合约的形式、通过我们自己的接口调用。

## 9. 红队测试结果

该测试套件（`test/redteam`，覆盖 spec 08 的各类攻击）已于 2026-10-18 针对完整的本地栈（分叉，域名 `Praetor-local`）运行，并写入 [redteam.md](../security/redteam.md)：每个用例包含输入、预期与观察到的结果以及交易哈希，汇总为 "N attacks, 0 executed"。

| 运行 | 命令 | 攻击数 | 得逞 | 结果 |
|---|---|---|---|---|
| 脚本化 | `make redteam` | 85 | **0** | 85 个均按预期被拦截 |
| 全局（共享状态，事后恢复） | `make redteam-global`（`REDTEAM_GLOBAL=1`） | 3 | **0** | 3 个被拦截：tXAG 处于 DELISTED 时兑换、所有价格过期时兑换、全局冻结期间付款 |
| 实时，真实模型（经 OpenCode 调用 DeepSeek） | `make redteam-live` | 12 | **0** | 3 个被系统拦截，9 个被模型拒绝；对应的脚本化用例证明系统同样会拦截这些攻击 |

**得逞**（executed，D60）指发生了授权委托不允许的价值或权限转移，依据每次攻击前后的链上状态判断（账户转出的代币、策略哈希、智能体密钥、绑定、状态及其 nonce、hook、所有者密钥、审批与所有者操作），或系统接受了被禁止的请求（攻击 userOp 或交易成功、HTTP 2xx 或 101、签发了 OAuth 令牌或重定向、工具输出中出现预置的 KYC 数据）；从不依据工具或模型说了什么。脚本化运行只有在每个用例都被拦截时才通过，实时运行要求每个用例被拦截或被模型拒绝，出错则一律失败。实时驱动只统计授权委托之外的转出，因为真实模型可能自行向白名单内的收款方付款。

早先运行中的发现（D62）均未转移任何价值，已全部修复并重新测试：

- **D86。** 每个账户的 OpenCode 配置禁用了网络工具，因此不再提供它们（`webfetch` 调用曾使轮次挂起）；超时的轮次会中止其 OpenCode 会话；Caddy 的配置文件变化时会重建容器，从而真正下发 Content-Security-Policy、HSTS 和 X-Frame-Options 头（RT-82、RT-84）。
- **D87。** mcp 只接受来自 agent-runner 地址的智能体 bearer（此前 Docker 主机的网桥网关也被接受，RT-73）；收款方名称解析为完全相同的标签，否则解析为唯一包含该名称的标签；每个发送方同一时间只有一笔 FISCO 或柜台交易在途；演示账户保留真实模型。
- **D88。** 禁用六个 OpenCode 内置工具（不再提供）：`webfetch`、`websearch`、`glob` 和 `grep`，它们待处理的权限请求会破坏 OpenCode 的权限列表（agent-runner 看不到可拒绝的请求，轮次挂起），以及 `lsp` 和 `question`；其他内置工具仍由 agent-runner 拒绝。若某个轮次无法列出待处理的权限，它会立即停止并中止会话（失败即关闭；RT-85 是真实模型那次行为的脚本化对照）。

留出用例（在仓库之外编写）使用套件的 JSON 用例格式，通过 `REDTEAM_HELDOUT_DIR` 运行（D64）；这几次运行中没有留出用例（[MANUAL.md](../MANUAL.md) 步骤 7.1）。

## 10. 渗透测试

**在 Phase C 中填写**，使用团队的 AI 渗透测试流水线和人工测试：Web 应用、api、mcp 与 OAuth、小程序后端、微信回调、控制台。报告：`docs/security/pentest.md`，包含发现与修复。本评估给出的切入点：风险 19 至 25 以及 31。

## 11. TEE 检查清单结果

检查清单以及当前由代码强制的内容：[tee-checklist.md](../security/tee-checklist.md)。各 CVM（agent-signer、soter-attester）的结果**在 Phase C 的 Phala 部署之后**给出。
