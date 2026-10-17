# Evidence

Every transaction of the suites, executed and refused, per flow: Base Sepolia hashes (linked to https://sepolia.basescan.org) and FISCO BCOS hashes (with the block and the WeBASE link). Written by `scripts/evidence/collect.ts` during M16; do not edit by hand.

Status: not collected yet (M16 needs funded LIVE addresses, see `docs/BLOCKERS.md` B1).

## Agent with the real model (M8 smoke, local fork, 2026-10-17)

`pnpm exec tsx scripts/demo/smoke-real-model.ts` on a freshly onboarded account (KYC through the demo provider, agent key in agent-signer on the dstack simulator, KYA built by the bank). Model `opencode/deepseek-v4.1-flash-free` through OpenCode 1.19.3, built-in tools locked (Q34).

| Prompt | What the agent did | Result |
|---|---|---|
| "Pay the café 12.50" | `praetor_get_mandate`, `praetor_get_status`, `praetor_pay(Café, 12.50)` | T1, paid 12.50 USDC to Café Lumen, 16 s end to end ("Paid 12.50 USDC to Café Lumen. Tx: ...") |

The automated suites use the scripted model for determinism (F4, F5, tool lockdown, I9); this run shows the product path with the real model. The red-team suite with the real model is M16.
