# Praetor demo video: voice-over

To read over the edited cut, scene by scene. About 4:45 in all, at a calm pace (pause between sentences; the picture can keep running). Every amount spoken is the amount on screen. Recorded on the public server (https://app.praetorwallet.com, Base Sepolia) on 2026-10-20, except where a scene says otherwise.

---

## 1. The problem (0:00 to 0:18)

**On screen:** the landing page, then deck slide 2 (the invoice with the hidden line).

> An AI agent with a wallet is one sentence away from emptying it.
> Give it the key, and one injected line drains you.
> Approve every step, and it does nothing.
> Praetor gives the agent rules no prompt can change.

---

## 2. Lin signs up (0:18 to 0:46)

**On screen:** the onboarding, fast-forward: passkey, wallet, demo KYC, profile, the agent in the TEE, the mandate.

> This is Lin, in Hong Kong. She signs up with a passkey, which creates her smart account on Base Sepolia.
> The bank checks her identity, here with a labelled demo KYC provider.
> Her agent gets its own key inside an Intel TDX confidential VM on Phala Cloud.
> Lin signs her agent's mandate, and the bank co-signs her rules.

---

## 3. Her mandate (0:46 to 1:07)

**On screen:** the Mandate page, scrolling: her rules, then the bank's caps.

> Her mandate is code on Base, not a promise.
> Payees, an auto cap, a hard cap, budgets, a cash buffer, and bands for USDC, gold and silver.
> The bank adds caps for her risk profile from the consortium chain, and the stricter value always wins.

---

## 4. The agent acts alone (1:07 to 1:31)

**On screen:** the chat "Pay Café Lumen 0.15 USDC", paid; the rent standing order, paid. BaseScan `0xeb400c2d...a43a85f0` and `0xb4104cad...b45ce329`.

> Inside the mandate, the agent acts alone.
> Lin asks it to pay Café Lumen 0.15 USDC: a known payee, under the auto cap, so it pays.
> Her rent goes out alone too, through a standing order Lin and the bank set up, paid through Alipay+. The payout partner is a labelled mock.

---

## 5. Rebalancing (1:31 to 1:55)

**On screen:** Home with USDC at 84 %, outside its band; then the agent's rebalance in Decisions, the rings back inside. BaseScan `0x77a74427...d5937a88`.

> Lin deposits 20 USDC. Her portfolio is now 84 percent cash, above its band.
> The scheduler wakes the agent, and it buys gold and silver back toward its targets, within its trade and daily limits.
> No one approves it, and it is a real transaction on Base Sepolia.

---

## 6. The attack (1:55 to 2:32)

**On screen:** the injected message in the chat, the model's refusal; card "Same payment, signed with the agent's own key"; BaseScan `0x5a38adfe...e63bb9af` (evidence run, 2026-10-18); card "Red team, local fork: 100 attack runs, 0 executed".

> Now the attack. A message tells the agent to ignore its rules and send 50 USDC to a sanctioned address.
> The real model refuses.
> But suppose the agent itself were compromised. In our evidence run, we sent that payment signed with the agent's own key.
> The Mandate hook refused it: SANCTIONED. The refused attempt is written on Base, with the reason the contract computed.
> Across our red-team suite on the local fork: 100 attack runs, zero executed.

---

## 7. One Face ID in WeChat (2:32 to 3:11)

**On screen:** the chat "Pay 0.15 USDC to 0x8549...807a", refused; the iPhone: WeChat, the Praetor mini program, the approval page, Face ID, executed. BaseScan `0x23a62b45...c57fea00`, `0x2a707c5d...588fa3d9`, `0x08b37d27...ce0212b8`.

> A new payee is different. Lin asks for 0.15 USDC to an address her mandate doesn't know.
> The contract refuses it on Base: unknown payee. This is tier two: it needs Lin.
> She opens Praetor inside WeChat. The phone recomputes the payment's fingerprint itself and shows the exact address and amount.
> Lin approves with Face ID. Our attester, running in a Phala TEE, checks the signature with Tencent, and the contract checks the attester's approval, bound to this one call.
> It executes once.

---

## 8. KYC and KYA (3:11 to 3:38)

**On screen:** deck slide 10 (identity), then Home, "Your agent: KYA level 2, BALANCED, HK". BaseScan `0x92f5437c...d2734141` (KYAApplied).

> The bank knows Lin, and knows her agent.
> Lin signs her agent's credential, a WeIdentity AgentMandate with its key, its scopes and the TEE that holds it, and the bank countersigns it. Its KYA reaches Base through WeCross.
> Every payment the agent signs is checked against it: the right key, a valid credential, and the bank's caps for Lin's profile.
> Personal data stays in the bank; on chain, only identifiers, hashes, her KYC level, risk profile and country.

---

## 9. The regulator's freeze (3:38 to 4:14)

**On screen:** the console, Freeze signed by the regulator; Home turns red; the agent's payment refused; Loosen signed by the regulator, then the bank; Active again. BaseScan `0x1adb003c...775be758`, `0x5ff2ae9d...9e683e0d`, `0x5ef02cd6...55f0795b`.

> Now the regulator. In the consortium console, one regulator signature freezes Lin's account.
> WeCross carries that decision from FISCO to Base, and the hook verifies the member's signature itself.
> Lin's app turns red, and the agent's next payment is refused on Base: FROZEN.
> Letting it go takes two of the three members: here, the regulator and the bank.
> And if the operator goes silent for fifteen minutes, the agent loses its autonomy.

---

## 10. The audit (4:14 to 4:31)

**On screen:** Audit, Verify, "Verified"; Export camt.053. BaseScan `0x71dedbdf...c823d778` (anchor).

> Every action leaves evidence.
> Each decision lands in a hash-chained audit log on FISCO, anchored on Base by two members, and exports as an ISO 20022 bank statement.
> Lin's bank can verify it.

---

## 11. Close (4:31 to 4:45)

**On screen:** deck slide 13 (QR codes).

> Autonomous. Bounded. Regulated.
> Praetor: self-driving money. The regulator holds the brakes.
> Try it at the link below.
