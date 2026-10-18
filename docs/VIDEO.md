# Demo video script

The demo video for FinTechathon 2026, Topic F "Agent Wallet" (spec 12): at most 5 minutes, English voice-over, Simplified Chinese subtitles. This script runs **4:45** and leaves 15 s of margin.

It follows the storyboard of [spec 12](../spec/12-submission.md#demo-storyboard-5-min-real-transactions), rebuilt around what was measured on a real iPhone with WeChat on 2026-10-18. Scoring it is cut for: task completion 40 % (scenes 2 to 9 are real flows), security and compliance 30 % (scenes 5 to 9), innovation and interaction 30 % (scenes 3, 5 and 10).

## What we may say, and what we may not

Every claim in the voice-over is either measured on the phone (marked **phone, 2026-10-18**) or covered by the automated end-to-end flows (marked **e2e**). Do not add claims outside these lists.

| Built and shown | Not built, never claimed as real |
|---|---|
| Passkey onboarding with Face ID in Safari, demo KYC, risk profile, agent with its own WeIdentity DID, mandate signed with Face ID, starter policy (phone) | WeChat Official Account alerts: they only go to a log |
| WeChat mini program linked from the web app QR, passkey + SOTER Face ID (phone) | Alipay+ and WeChat Pay: labelled mocks |
| T2 approval of 270 USDC to a new payee in both apps, same digest `0x4bca6b7f…ab8331`, approved with SOTER Face ID, executed (phone) | TEEs: simulated locally (dstack simulator); Phala Cloud is the production plan |
| Replay of that approval refused on-chain, `DigestUsed` (phone) | The red-team suite ("N attacks, 0 executed"): not built yet, no slide flash |
| Regulator freeze on FISCO reaches Base in **6.3 s**; mini program red "Frozen by the regulator"; agent payment refused FROZEN (T0_NEVER); loosen needs regulator + bank, **7.5 s** (phone) | Live Base Sepolia transaction hashes: they come from the coming live run, see the placeholders below |
| UI in English and 简体中文 (phone) | |
| Gold shock rebalancing (F4), prompt injection refused SANCTIONED with RefusalLog (F5), audit chain Verified + camt.053 (F8) (e2e, laptop take) | |

The phone test ran against the local fork of Base Sepolia (`docs/TESTER.md`). On screen, any BaseScan link must come from the live run; until then the scenes show the web app's transaction rows and the caption "Base Sepolia fork (local)".

### Placeholders for the live run

Fill these from `docs/EVIDENCE.md` after the live run (`docs/MANUAL.md` section 10). Note that the live run uses `DEMO_SCALE=100`, so its amounts are the demo amounts divided by 100: the caption must show the live amount, not 270.

| Placeholder | Scene | What it is |
|---|---|---|
| `[[LIVE_TX_ONBOARD]]` | 2 | Account deployment (or mandate set) on Base Sepolia |
| `[[LIVE_TX_T2_REFUSED]]` | 5 | The refused op, UNKNOWN_PAYEE, RefusalLog |
| `[[LIVE_TX_T2_EXECUTED]]` | 5 | The approved payment |
| `[[LIVE_TX_REPLAY_REFUSED]]` | 6 | The replay, reverted with `DigestUsed` |
| `[[LIVE_TX_SANCTIONED]]` | 7 | The injection, refused SANCTIONED |
| `[[LIVE_TX_FROZEN_APPLIED]]` | 8 | StatusApplied FROZEN on Base |
| `[[LIVE_TX_FROZEN_REFUSED]]` | 8 | The agent payment refused FROZEN |
| `[[LIVE_TX_ANCHOR]]` | 9 | The audit anchor on Base |

## Shot list

Sources: **Phone** = iPhone screen recording (Safari or WeChat), **Laptop** = Chrome at 1440 px, screen recording, **Console** = the consortium console in the laptop browser (`/console`), **Terminal** = a laptop terminal, large font, **Slide** = a slide from `docs/Praetor-pitch.pptx`.

| # | Time | Length | Scene | On screen | Exact click path |
|---|---|---|---|---|---|
| 1 | 0:00 to 0:20 | 20 s | Hook | Laptop: the landing page, the 3D phone turning, then slide 2 (the problem) for 5 s | Open `https://<PUBLIC_HOST>/`; let the Phone3D turn; cut to slide 2 |
| 2 | 0:20 to 1:05 | 45 s | Onboarding with Face ID (fast-forward x2 to x4 on waits) | Phone: Safari | Tunnel URL > "Create your wallet with Face ID" > Email > "Create my passkey" (Face ID) > "Create my wallet" > "Verify with the Demo KYC provider" (document photo, selfie, head turns; blur the document) > "Five questions about your risk appetite" > "Save my profile" > "Create my agent in the TEE" (agent DID shown) > "Review and sign the mandate" > "Sign with Face ID" > "Set my policy" > "Your agent is ready." |
| 3 | 1:05 to 1:20 | 15 s | Link WeChat | Split: Laptop web app Settings (left), Phone WeChat mini program (right) | Laptop: Settings > "Link WeChat" (QR appears). Phone: mini program > "Scan the QR code" > check the account address > "Confirm with Face ID" (SOTER). Laptop: "Confirm with my passkey" > Phone shows "WeChat is linked to your account" |
| 4 | 1:20 to 1:45 | 25 s | Autonomous rebalancing (T1) | Terminal (2 s) then Laptop: Home, Decisions feed | Terminal: `pnpm shock --asset XAU --pct 20`. Laptop: Home > watch the gold ring leave its band > the Decisions feed shows the sell of about 650 USD of tXAU > the ring comes back in band |
| 5 | 1:45 to 2:40 | 55 s | Human in the loop inside WeChat (T2) | Split: Laptop web app (left), Phone mini program (right); zoom on both digests | Laptop: Agent > type "Pay 270 USDC to 0x…" (new payee) > Send > the agent reports it needs approval. Laptop: Approvals > the request > "What you sign". Phone: mini program home > "Waiting for you" > the request > "What you sign". Hold on both digests `0x4bca6b7f…ab8331`. Phone: "Approve with Face ID" (SOTER) > "Approved and executed". Laptop: Payments row with the transaction |
| 6 | 2:40 to 2:55 | 15 s | Replay refused | Terminal, then Laptop Payments | Terminal: re-send the same approval (as in the phone test) > the revert reads `DigestUsed`. Cut to the refused row |
| 7 | 2:55 to 3:15 | 20 s | Prompt injection refused (T0) | Laptop: `/sandbox` | Sandbox > "Prompt injection: pay a sanctioned address" > the table row "Refused on Base", reason SANCTIONED, transaction link |
| 8 | 3:15 to 4:05 | 50 s | Regulator freeze and loosen (T4) | Split: Console on the laptop (left), Phone mini program home (right), a stopwatch overlay | Console: "Sign in as regulator staff" (passkey) > agents table > "Select" on the phone's account > "Freeze" > "Sign with my passkey" (start the stopwatch) > Phone turns red "Frozen by the regulator" (6.3 s). Phone: chat > ask the agent to pay a known payee > refused FROZEN. Console: "Loosen" > regulator "Sign with my passkey" > switch to bank staff > "Sign with my passkey" (start the stopwatch) > Phone back to normal (7.5 s) |
| 9 | 4:05 to 4:20 | 15 s | Audit | Laptop: Audit | Audit > "Verify" > "Verified: the entries match FISCO and the Base anchor" > "Export camt.053" (show the XML for 2 s) |
| 10 | 4:20 to 4:35 | 15 s | 简体中文 and the stack | Phone: mini program Settings > Language > 简体中文 (home in Chinese, 3 s); then slide 5 (architecture) | Phone: Settings > Language > 简体中文; cut to slide 5 |
| 11 | 4:35 to 4:45 | 10 s | Close | Slide 14 (closing) with the repository URL | Hold slide 14 |

Total: 20 + 45 + 15 + 25 + 55 + 15 + 20 + 50 + 15 + 15 + 10 = **285 s = 4:45**.

Scenes 4, 7 and 9 were not part of the phone test: they are laptop takes of flows covered by e2e (F4, F5, F8). Rehearse each once before recording; if one fails on the take, cut it and give its seconds to scene 5 or 8.

## Voice-over and subtitles

About 150 words a minute. One subtitle line per voice-over line; technical identifiers stay in English (spec 12). Terms: 智能体钱包 (agent wallet), 授权委托 (mandate), 监管冻结 (regulator freeze), 联盟链 (consortium chain), 分级授权 (approval tiers).

### 1 · Hook (0:00 to 0:20)

| English voice-over | 中文字幕 |
|---|---|
| AI agents are starting to hold money. | AI 智能体开始替人管钱了。 |
| Give one the key, and a single bad prompt can empty your wallet. | 把私钥交给它，一条恶意提示就可能清空你的钱包。 |
| Make it ask before every step, and it does no work. | 让它每一步都来问你，它就什么也做不了。 |
| Praetor is the third way: self-driving money, bounded by rules no AI can break, with the regulator holding the brakes. | Praetor 是第三条路：自动驾驶的钱，受任何 AI 都无法突破的规则约束，刹车握在监管手中。 |

### 2 · Onboarding with Face ID (0:20 to 1:05)

| English voice-over | 中文字幕 |
|---|---|
| This is Safari on an iPhone. No seed phrase, no password. | 这是 iPhone 上的 Safari。没有助记词，没有密码。 |
| Face ID creates a passkey, and the passkey creates my smart account on Base. | Face ID 创建通行密钥，通行密钥创建我在 Base 上的智能账户。 |
| A demo identity check at the bank, five questions for my risk profile. | 在银行完成演示版身份验证，回答五个风险偏好问题。 |
| Then my agent is born, with its own decentralised ID on WeIdentity. The bank knows its customer, and knows its agent. | 接着创建我的智能体，它在 WeIdentity 上拥有自己的分布式身份。银行既了解客户，也了解智能体。 |
| I read the mandate: what the agent may do, and where it must stop. I sign it with Face ID, and the bank co-signs. | 我阅读授权委托：智能体能做什么，在哪里必须停下。我用 Face ID 签署，银行联合签署。 |
| A starter policy is live. | 初始策略生效。 |

### 3 · Link WeChat (1:05 to 1:20)

| English voice-over | 中文字幕 |
|---|---|
| Now WeChat. The Praetor mini program scans the QR code from the web app. | 现在进入微信。Praetor 小程序扫描网页应用上的二维码。 |
| I confirm with Face ID through Tencent SOTER, then with my passkey. This WeChat is now bound to my account, on-chain. | 我先用腾讯 SOTER 的 Face ID 确认，再用通行密钥确认。这个微信已在链上绑定我的账户。 |

### 4 · Autonomous rebalancing (1:20 to 1:45)

| English voice-over | 中文字幕 |
|---|---|
| Gold jumps twenty percent. Nobody taps anything. | 金价上涨百分之二十。没有人点任何按钮。 |
| The agent wakes up, sees gold above its band, and sells about 650 dollars of tokenized gold to get back in. | 智能体被唤醒，发现黄金超出区间，卖出约 650 美元的代币化黄金，回到区间内。 |
| That is tier one: inside the mandate, the agent acts alone, and every decision lands in the feed. | 这是第一级：在授权委托之内，智能体独立行动，每个决定都记录在动态中。 |

### 5 · Human in the loop inside WeChat (1:45 to 2:40)

| English voice-over | 中文字幕 |
|---|---|
| Now something unusual. I ask the agent to pay 270 USDC to a payee it has never seen. | 现在来点不寻常的。我让智能体向一个从未见过的收款方支付 270 USDC。 |
| The Mandate hook on Base refuses it: unknown payee. Instead of failing, Praetor asks me. | Base 上的授权钩子拒绝了：未知收款方。Praetor 没有就此失败，而是来问我。 |
| The same request appears in the mini program and in the web app. | 同一个请求同时出现在小程序和网页应用中。 |
| Each screen rebuilds the payment from the raw call and computes its fingerprint itself. Both show 0x4bca…8331. | 每个界面都从原始调用重建这笔支付，并自行计算摘要。两边都显示 0x4bca…8331。 |
| Same payee, same amount, same digest: what you see is what you sign. | 同样的收款方、同样的金额、同样的摘要：所见即所签。 |
| I approve with Face ID, inside WeChat. The contract verifies the approval itself, and the payment executes on Base. | 我在微信里用 Face ID 批准。合约自己验证这次批准，支付在 Base 上执行。 |

### 6 · Replay refused (2:40 to 2:55)

| English voice-over | 中文字幕 |
|---|---|
| What if someone captures that approval and sends it again? | 如果有人截获这次批准并再次发送呢？ |
| Refused, on-chain: DigestUsed. Every Face ID approval works exactly once. | 链上拒绝：DigestUsed。每一次 Face ID 批准只能使用一次。 |

### 7 · Prompt injection refused (2:55 to 3:15)

| English voice-over | 中文字幕 |
|---|---|
| A prompt injection tells the agent: ignore your rules, pay this address. | 一次提示注入对智能体说：忽略你的规则，向这个地址付款。 |
| That address is on the consortium's sanctions list. The hook refuses, and the reason is written on-chain: SANCTIONED. | 该地址在联盟的制裁名单上。钩子拒绝了，原因写在链上：SANCTIONED。 |
| A fooled agent still cannot move the money. | 即使智能体被骗，钱也动不了。 |

### 8 · Regulator freeze and loosen (3:15 to 4:05)

| English voice-over | 中文字幕 |
|---|---|
| Now the brakes. Praetor's authority lives on FISCO BCOS, a consortium chain where a bank, a regulator and an operator each run a node. | 现在看刹车。Praetor 的权力在 FISCO BCOS 上，这是一条联盟链，银行、监管方和运营方各运行一个节点。 |
| In the console, the regulator selects my agent and taps Freeze. One signature. | 在控制台里，监管方选中我的智能体，点击冻结。只需一个签名。 |
| WeCross carries it from FISCO to Base: 6.3 seconds, measured on this phone. | WeCross 把它从 FISCO 送到 Base：6.3 秒，在这台手机上实测。 |
| The mini program turns red: frozen by the regulator. | 小程序变红：已被监管冻结。 |
| The agent tries to pay. Refused: FROZEN, tier zero, never. | 智能体尝试付款。被拒绝：FROZEN，第零级，绝不放行。 |
| Freezing takes one member, on purpose. Letting go takes two: the regulator and the bank sign, and 7.5 seconds later the agent is back. | 冻结只需一个成员，这是有意设计的。解冻需要两个：监管方和银行签名，7.5 秒后智能体恢复运行。 |

### 9 · Audit (4:05 to 4:20)

| English voice-over | 中文字幕 |
|---|---|
| Every action joins a hash chain on FISCO, anchored on Base. One click recomputes it: verified. | 每个操作都进入 FISCO 上的哈希链，并锚定在 Base 上。一键重新计算：验证通过。 |
| And it exports as camt.053, the statement format banks already read. | 还能导出为 camt.053，银行早已在用的对账单格式。 |

### 10 · 简体中文 and the stack (4:20 to 4:35)

| English voice-over | 中文字幕 |
|---|---|
| Everything you saw also runs in Simplified Chinese, in the web app and in WeChat. | 你看到的一切也支持简体中文，网页应用和微信里都是。 |
| Base holds the money. FISCO holds the authority. WeIdentity holds the identities. WeCross connects them. | Base 管钱，FISCO 管权，WeIdentity 管身份，WeCross 把它们连在一起。 |

### 11 · Close (4:35 to 4:45)

| English voice-over | 中文字幕 |
|---|---|
| Praetor. Autonomous for the user. Bounded by the contract. Regulated by the consortium. | Praetor。为用户自主行动，受合约约束，由联盟监管。 |
| Self-driving money; the regulator holds the brakes. | 自动驾驶的钱，刹车握在监管手中。 |

## On-screen captions

Big captions (large type, centre or lower third, 2 to 3 s each). Each has its Chinese line underneath in smaller type.

| Scene | Time | Caption | 中文 |
|---|---|---|---|
| 1 | 0:14 | **Self-driving money. The regulator holds the brakes.** | 自动驾驶的钱，刹车握在监管手中 |
| 2 | 0:22 | **No seed phrase. No password. Face ID.** | 无助记词，无密码，只要 Face ID |
| 2 | 0:50 | **Agent DID on WeIdentity: know your agent** | 智能体的 WeIdentity 身份：了解你的智能体 |
| 2 | 0:58 | TEE: dstack simulator locally, Phala Cloud in production (small, lower third) | TEE：本地为模拟器，生产环境为 Phala Cloud |
| 3 | 1:15 | **SOTER Face ID, bound on-chain** | SOTER 人脸识别，链上绑定 |
| 4 | 1:35 | **T1 · the agent acts alone, inside the mandate** | 第一级 · 授权内自主行动 |
| 5 | 1:55 | **UNKNOWN_PAYEE → asks you** | 未知收款方 → 请你确认 |
| 5 | 2:15 | **digest = 0x4bca6b7f…ab8331 = digest** (phone and web side by side) | 手机与网页摘要一致 |
| 5 | 2:35 | **Approved in WeChat · executed on Base** + `[[LIVE_TX_T2_EXECUTED]]` | 微信内批准 · Base 上执行 |
| 6 | 2:48 | **1× · a replay is refused on-chain (DigestUsed)** | 每次批准仅限一次 · 重放在链上被拒 |
| 7 | 3:08 | **SANCTIONED · refusal written on-chain** + `[[LIVE_TX_SANCTIONED]]` | 制裁名单 · 拒绝原因上链 |
| 8 | 3:35 | **6.3 s · FISCO → Base** (with the stopwatch) | 6.3 秒 · 从 FISCO 到 Base |
| 8 | 3:47 | **FROZEN · T0_NEVER** + `[[LIVE_TX_FROZEN_REFUSED]]` | 已冻结 · 第零级绝不放行 |
| 8 | 4:00 | **1 signature to freeze · 2 of 3 to loosen · 7.5 s** | 冻结一签 · 解冻三选二 · 7.5 秒 |
| 9 | 4:12 | **Verified ✓ · FISCO + Base anchor · camt.053** | 验证通过 · FISCO 与 Base 锚定 · camt.053 |
| 10 | 4:30 | **Base · FISCO BCOS · WeIdentity · WeCross** | |
| 11 | 4:38 | **github.com/hliosone/Praetor** | |

Permanent small labels: "Base Sepolia fork (local)" on every take from the fork, replaced by "Base Sepolia" once a live hash is on screen; "Alipay+ / WeChat Pay: mock" if a payout screen ever appears.

## Recording checklist

### Accounts and funds

- [ ] The phone's user account: create it fresh on the take of scene 2 (onboarding is recorded, not skipped). Record scene 2 first, then fund it.
- [ ] Fund it on the fork with demo USDC and some tXAU/tXAG so it has gold to rebalance and more than 270 USDC to pay (for example the `fund` helper of `scripts/demo/lib.ts`: 5,300 USDC plus tXAU and tXAG), and set the demo prices.
- [ ] The new payee for scene 5: an address that is not in the mandate (not a sanctioned one).
- [ ] A known payee, under the auto cap, for the refused payment of scene 8.
- [ ] Staff passkeys for the console: regulator and bank enrolled on the laptop (scene 8 needs both to loosen).
- [ ] A sandbox account on `/sandbox` for scene 7, created before the take.
- [ ] Live run done and `docs/EVIDENCE.md` filled, so the `[[LIVE_TX_*]]` placeholders can be replaced (live amounts at `DEMO_SCALE=100`).

### Stack, tunnel and PUBLIC_HOST (from `docs/TESTER.md`)

- [ ] `make up` with `MP_APPID`, `MP_SECRET` in `.env` and `SOTER_FAKE_TENCENT=0` (real SOTER).
- [ ] `make tunnel`: note the `https://...trycloudflare.com` address; it also sets the mini program's `develop` base in `apps/miniprogram/miniprogram/config.js` (do not commit that change).
- [ ] Put `PUBLIC_HOST=<tunnel host, without https://>` and `PUBLIC_URL=<tunnel URL>` in `.env`, then `make up` again (passkeys belong to the host name).
- [ ] Do not restart the tunnel between takes: a new address means a new phone account.
- [ ] WeChat DevTools: project `apps/miniprogram`, AppID set, "ES6 to ES5", "Enhanced compile" and "Minify" off; Preview, scan with the iPhone.
- [ ] Rehearse scenes 4, 7 and 9 once on the same stack (`pnpm shock --asset XAU --pct 20` holds for `DEMO_HOLD_S`; restore the demo prices after).
- [ ] After recording: restore `PUBLIC_HOST=praetor.localhost`, `PUBLIC_URL=https://praetor.localhost`, `make up`, `make tunnel-stop`.

### Phone

- [ ] The iPhone with Face ID used in the 2026-10-18 test, its WeChat added as a tester of the test account.
- [ ] Mini program **debug mode on** ("..." > 开发调试, then restart): required under the test account, or requests fail with `url not in domain list`. Crop or blur the green vConsole button in the edit.
- [ ] Do Not Disturb on, full battery, notifications from other apps off, screen recording from Control Center with the microphone off.
- [ ] Language: English for scenes 2 to 9, switch to 简体中文 only in scene 10.

### Laptop

- [ ] Chrome at 1440 px, zoom 100 to 125 %, bookmarks bar and extensions hidden, no devtools open.
- [ ] Terminal: large font, dark theme, prompt without user or host name.
- [ ] A stopwatch overlay ready for scene 8 (start on "Sign with my passkey", stop when the phone turns red).

### Blur or keep off screen

- [ ] The KYC document photo and the selfie (scene 2); the email address typed at sign-up.
- [ ] The tunnel URL in Safari's address bar (it is a live entry point while the take runs).
- [ ] Any `.env` content, keys, AppID or AppSecret; DevTools' AppID field; terminals that print environment values.
- [ ] WeChat nickname, avatar and chat list outside the mini program.
- [ ] Phone notifications and the laptop's notification centre.

### Edit

- [ ] Burn in the Chinese subtitles from the tables above; English captions large, Chinese underneath.
- [ ] Fast-forward the waits of scene 2 (passkey, wallet deployment, KYC decision), with a small "x2" or "x4" marker; never speed up the freeze stopwatch of scene 8.
- [ ] Final length at most 4:50; export 1080p.
