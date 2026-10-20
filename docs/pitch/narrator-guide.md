# Praetor: guide for the narrator

For whoever voices the demo video or gives the pitch without having built Praetor. Read this once (10 minutes), then read `voiceover.md` (the exact lines for the video) and `speaker-notes.md` (the deck). Everything here is true and checked; the "Never say" list at the end matters.

---

## 1. Praetor in 30 seconds

An AI agent manages a person's money: it pays her bills, pays merchants, and keeps her portfolio of USDC, tokenised gold and tokenised silver inside its target bands. It does this from a smart account on **Base Sepolia** (an Ethereum layer 2 testnet).

The agent is powerful, so Praetor bounds it:

- **The owner's rules** (her "mandate") are code on Base, in a contract called the **Mandate hook**. Every action of the account passes through it. Default: deny.
- **The authority** (who the person is, what is allowed, who can stop the agent) sits with a **consortium** of a **bank**, a **regulator** and an **operator** on **FISCO BCOS**, WeBank's consortium blockchain. Their decisions reach Base through **WeCross**, WeBank's cross-chain router, and the hook checks their signatures itself.

Pitch line: **"Self-driving money. The regulator holds the brakes."** Positioning: Praetor is the **control plane for regulated AI agent wallets**: not one app, the infrastructure a bank would run to let customers use agents safely.

---

## 2. The cast

| Who | What they do |
|---|---|
| **Lin** | The owner, in Hong Kong. Signs with a passkey (Face ID). |
| **Her agent** | A real LLM (DeepSeek, through OpenCode). It can only act through Praetor's tools (an MCP server). It never sees a private key. |
| **The agent's key** | Created inside a **TEE** (a confidential VM, Intel TDX) on **Phala Cloud**. Nobody, not even us, can read it. |
| **The bank** | Does KYC, issues credentials, sets caps per risk profile, co-signs the owner's rules. |
| **The regulator** | Keeps the sanctions list and blocked jurisdictions; can freeze an account with one signature. |
| **The operator** | Runs the system; sends a heartbeat. If it goes silent for 15 minutes, every agent loses its autonomy. |

---

## 3. The ideas you need

- **Mandate**: Lin's rules on Base: who she pays (payees), how much the agent may pay alone (auto cap), never more than (hard cap), daily and monthly budgets, a cash buffer, bands for USDC, gold and silver, trade size and slippage limits, an expiry. The bank adds its own caps for her risk profile; **the stricter value always wins**.
- **Tiers** (how much permission an action needs):
  - **T0** never (sanctioned, frozen, forbidden calls);
  - **T1** the agent alone (inside the mandate);
  - **T2** Lin's Face ID (a new payee, a large payment);
  - **T3** Lin and the bank (changing her rules);
  - **T4** the consortium (freeze, sanctions, caps).
- **One approval = one exact payment, once.** An approval is bound to the exact call (a fingerprint); replayed, it is refused (`DigestUsed`).
- **KYC and KYA.** KYC: the bank knows Lin (a WeIdentity credential, `PersonKYC`). **KYA, Know Your Agent**: the bank knows her agent. The agent's credential (`AgentMandate`) holds the agent's key, its scopes (pay, rebalance, standing orders), the mandate's fingerprint and the TEE it runs in; Lin signs it, the bank countersigns it, it is recorded on FISCO and carried to Base. **Every payment the agent signs is checked against it.** Without a valid KYA the contract refuses every call.
- **Privacy.** Personal data stays encrypted at the bank. On chain there are only identifiers, hashes and three pseudonymous attributes: KYC level, risk profile, country.
- **WeChat approval.** Lin can approve in the Praetor mini program inside WeChat with Face ID (Tencent **SOTER**). Our **attester**, itself in a Phala TEE, checks the SOTER signature with Tencent; the contract checks the attester's approval.
- **Standing orders.** Recurring bills (rent) set up by Lin and the bank, paid automatically through a payout partner (Alipay+ and WeChat Pay, both labelled mocks).
- **Audit.** Every decision is written to a hash-chained log on FISCO, anchored on Base by two members, and exported as an **ISO 20022 camt.053** bank statement.
- **x402.** A web standard where an API answers "402 Payment Required" and the agent pays to get the resource. Most agent wallets pay x402 by signing an off-chain USDC authorization, which moves money with **no policy at all**. Praetor closes that path on purpose; its agent pays the 402 **through its mandate** and then proves the payment. (Built and tested on the local stack; not in the video.)
- **Amounts.** On the public server amounts are a hundredth of the story's (testnet budget): 0.15 USDC on chain stands for 15.

---

## 4. The video, scene by scene

Exact lines: `voiceover.md`. Here: what is on screen and what it proves. Everything was recorded on the public server, `https://app.praetorwallet.com`, with real transactions on Base Sepolia, except the red-team numbers and the SANCTIONED example (scene 6), which come from our local tests and an earlier evidence run.

| # | On screen | What it proves |
|---|---|---|
| 1 | Landing; the poisoned invoice | The problem: an agent with a key can be talked into draining the wallet; approving every step makes it useless. |
| 2 | Sign-up | Passkey account, KYC by the bank (labelled demo vendor), the agent's key born in a real Intel TDX TEE, the mandate signed by Lin and co-signed by the bank. |
| 3 | The Mandate page | The rules are code on Base; the bank's caps come from FISCO; the stricter wins. |
| 4 | Café Lumen paid; rent paid | T1: inside the mandate, the agent pays alone; bills go out alone. |
| 5 | Cash at 84 %, then back in band | After a deposit the scheduler wakes the agent; it buys gold and silver back to target, alone, on Base. |
| 6 | The injected message, refused | Two layers: the model refuses; and even a compromised agent key is refused by the contract (SANCTIONED). 100 attack runs, 0 executed. |
| 7 | A new payee, approved in WeChat | T2: the contract refuses an unknown payee; Lin approves one exact payment with Face ID in WeChat; it executes once. |
| 8 | Identity diagram; "KYA level 2, BALANCED, HK" | KYC and KYA as credentials; every agent payment is checked against the agent's credential; no personal data on chain. |
| 9 | Console: freeze; app red; payment refused; loosen | One regulator signature freezes, carried FISCO to Base by WeCross; the agent's payment is refused FROZEN on Base; loosening takes two of three members. |
| 10 | Audit verified; camt.053 | Every action is provable, anchored on Base, exportable as a bank statement. |
| 11 | End card | Try it, video, evidence. |

---

## 5. The live pitch (deck, about 9 minutes)

One sentence per slide; `speaker-notes.md` has the full notes.

1. **Title.** Praetor, self-driving money, the regulator holds the brakes.
2. **The problem.** One injected sentence drains an agent wallet; approving everything makes the agent useless; and no bank or regulator can stop it.
3. **Lin's agent.** Holds USDC, gold and silver, pays bills, asks Lin only when it matters.
4. **Architecture.** Money on Base, authority on FISCO; the backend can delay, never forge.
5. **The mandate.** Code on chain, set with Face ID, co-signed by the bank; the stricter value wins.
6. **The agent alone.** Real payments and a rebalance on Base Sepolia, no approval needed.
7. **One path, three endings.** Every call: executed, asks the owner, or refused; tiers T0 to T4.
8. **The injection.** Refused by the model, and by the contract even with the agent's own key; 100 runs, 0 executed; x402 through the mandate.
9. **WeChat.** One Face ID approves one exact payment, once.
10. **Identity.** The bank knows Lin and her agent; no personal data on chain.
11. **The freeze.** One signature stops it, two of three let it go.
12. **Audit.** Hash-chained on FISCO, anchored on Base, ISO 20022.
13. **Close.** Try it at app.praetorwallet.com.

---

## 6. Questions the jury may ask

- **Why two chains?** Money and customers live on a public chain (Base); authority must sit with known, accountable institutions (FISCO consortium). Each does what it is good at.
- **What if your backend is hacked?** It can delay or drop messages, never forge them: the hook verifies every member signature and the owner's passkey itself. If the operator's heartbeat stops, agents lose their autonomy.
- **What if the AI is jailbroken?** It still cannot leave the mandate: the contract enforces the rules on every call, whatever the model says. Our red team ran 100 attacks (on the local stack), 0 executed.
- **Who holds the agent's key?** A signing service inside a Phala TEE; the bank verifies the TEE's attestation before issuing the agent's credential.
- **What is real, what is mocked?** Real: the contracts, Base Sepolia, FISCO, WeIdentity, WeCross, the TEEs on Phala, the LLM, WeChat SOTER, Pyth prices. Mocked and labelled: the KYC vendor, the payout partner and the Alipay+ / WeChat Pay gateways.
- **Why does it matter for a bank like WeBank?** It lets a regulated institution offer agentic finance with KYC, KYA, sanctions, caps, freeze and audit built in, on WeBank's own open-source stack.
- **x402?** Supported through the mandate (pay, then prove); the usual off-chain authorization is refused by design because it would bypass every rule.

---

## 7. Never say

- That the model "tried to pay" the sanctioned address: **it refused**; the SANCTIONED refusal came from the same payment signed with the agent key, as a compromised agent would.
- Timings like "frozen in 6 seconds on Base Sepolia": the 6.3 s and 7.5 s were measured on the local fork.
- That personal data "never leaves the bank": identifiers, hashes, KYC level, risk profile and country are on chain.
- That the red team ran on Base Sepolia: it ran on the local fork.
- That the KYC vendor or Alipay+ are real integrations: they are labelled mocks.
- "Secure", "revolutionary", "scalable" without the mechanism behind it.
