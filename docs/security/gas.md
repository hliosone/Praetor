# Gas

Contract-level snapshot: `contracts/base/.gas-snapshot` (`forge snapshot`, unit tests). UserOp-level figures come from the bundler integration test on the anvil fork of Base Sepolia with the RIP-7212 P-256 precompile (`anvil --network optimism`), written to `.run/gas-fork.json` on every run; `actualGasUsed` includes the 100,000 preVerificationGas the bundler sets.

| Step | Gas (M3, fork) | Reference (Alex's skeleton) | Note |
|---|---|---|---|
| First userOp: deploy + setupSafe + init batch, passkey-validated, sponsored | 1,077,773 | 1,350,131 in V1 (forge, no precompile: FCL fallback) | WebAuthn on the precompile |
| Agent payment (USDC transfer, T1) | 448,833 | n/a | full decision order + three spend counters written + Decision event |
| Refused agent op (lands with success = false) | 302,463 | about 146,000 | our hook evaluates the whole mandate before refusing |
| `RefusalLog.log` | 117,810 | about 27,500 | the reason is computed on-chain by `check()` (I11), not declared |

At the 0.006 gwei measured on Base Sepolia (V10), an agent payment costs about 2.7e-6 ETH. Regression guards in the integration test: agent payment and refused op below 550,000.
