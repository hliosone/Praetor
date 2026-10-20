# Evidence: the public server

The public server at **https://app.praetorwallet.com**, its two TEEs on Phala Cloud and the first account run on it with WeChat, on **Base Sepolia (live)**. Written by hand on 2026-10-20 from reads of Base Sepolia (`eth_getTransactionReceipt`, `eth_getLogs` and the hook's view functions through `https://base-sepolia-rpc.publicnode.com`); every transaction below has receipt status 1. This file is not generated: [EVIDENCE.md](EVIDENCE.md) is the evidence run of 2026-10-18 on the earlier M16 deployment, written by `scripts/evidence/collect.ts`. 中文: [zh-CN/EVIDENCE-SERVER.md](zh-CN/EVIDENCE-SERVER.md).

Amounts on the server are at `DEMO_SCALE` 100 (D74): 1 USDC on chain stands for 100 USDC in the story.

## The deployment

| What | Where |
|---|---|
| Web app and api | https://app.praetorwallet.com: Google Cloud Compute Engine `e2-standard-4`, `asia-east2-a` (Hong Kong), Ubuntu 24.04, static IPv4 34.96.209.53 (no IPv6), Let's Encrypt certificate through Caddy (D104, D106). [DEPLOY.md](DEPLOY.md) section 9 is the procedure |
| Base Sepolia contracts | The deployment of 2026-10-19 (D101), every address in `infra/deployments/base-sepolia.json`, EIP-712 domain `Praetor`, deployment block 48301428. MandateHook [`0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f`](https://sepolia.basescan.org/address/0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f), RefusalLog [`0x1Db00e4196Bfa4F800c05B02BF45540Bc2A501E6`](https://sepolia.basescan.org/address/0x1Db00e4196Bfa4F800c05B02BF45540Bc2A501E6), paymaster [`0x046922c731253E268B1856479D08a10b10Fa8314`](https://sepolia.basescan.org/address/0x046922c731253E268B1856479D08a10b10Fa8314) |
| FISCO BCOS consortium | The server's own FISCO chain and consortium (bank, regulator, operator), bound to this hook (D100). It has no public explorer, so its calls are not listed here |
| Prices | Real XAU and XAG prices from Pyth Hermes; at the consortium bootstrap tXAU 4,132.30 USD and tXAG 56.89 USD |
| TEEs | Two Phala Cloud CVMs in real Intel TDX, below |

## The two TEEs on Phala Cloud

Both CVMs run on Phala Cloud (`tdx.small`, the production OS image `dstack-0.5.12`, deployed with `--no-dev-os` and `--no-public-logs` by `scripts/deploy/phala-deploy.sh`), from private GHCR images built at commit `4b0f53b`, referenced by digest and pulled with a `read:packages` token passed as encrypted environment (D104, D106). Their secrets (the callers' HMAC keys, the WeChat app secret) are encrypted environment variables too. Both compose hashes are on the bank's allowlists. No key leaves a CVM: keys come from dstack's `getKey` inside it.

| CVM | Phala app id | Compose hash (the measurement the bank allows) | Key |
|---|---|---|---|
| agent-signer | `aaa39dc0d68be17ce5fa793b7d73e04d804270b3` | `0x0263abb547f749c270694185ecdc45be1f8ede2b7dc6a35b338aad3485f9f8d2` | one secp256k1 agent key per account |
| soter-attester | `00071068a34978c975ece991044599f80c75d138` | `0x7328c4f30902aedf162b865698b2f73602bb38449c932c57a2d6966fac150469` | the attester key that signs SOTER approvals |

**The attester's activation.** The bank asked the soter-attester CVM for a TDX quote whose report data binds the attester key to a bank nonce, sent it to Phala's verifier (`https://cloud-api.phala.com/api/v1/attestations/verify`), which answered verified, and read the compose hash from the verified quote's MRCONFIGID, where dstack writes `0x01` followed by the compose hash (Phala's answer no longer carries `app_info.compose_hash`; commit `9056861`). The hash is on the allowlist, so the bank signed the `AttesterAttestation`, which WeCross carried to Base in [`0x58cafa3e...4b9f3c24`](https://sepolia.basescan.org/tx/0x58cafa3eeb77dd5c6cccc2c5d5586e92b2fe4be3837dda5d7931c3f24b9f3c24): `AttesterApplied` for attester `0xd690B2E7312082D48d7667f78FD04482bE91b846` with the soter-attester's compose hash as its measurement, active. Read on 2026-10-20, the hook's `attesterOf(0xd690B2E7312082D48d7667f78FD04482bE91b846)` returns `0x7328c4f3...ac150469` and `true`.

**The agent key.** Agent keys on the server come from the agent-signer CVM; the simulator is refused in production (I13). The bank checked the agent-signer's quote the same way before its KYA: the account's KYA, delivered through WeCross in [`0xdccb5c43...2056aee0`](https://sepolia.basescan.org/tx/0xdccb5c433526c782f7c61806d7b95cc74d90a80e153ca5e8fdbc119a2056aee0), carries the agent-signer's compose hash `0x0263abb5...85f9f8d2` as its agent measurement.

What the deployment does not prove: callers reach each CVM through Phala's gateway, which terminates TLS outside the CVM (TEE checklist item 6), and the bank relies on Phala's verifier, not on its own parsing of the quote's TD attributes, to refuse a debug CVM (item 1): [security/tee-checklist.md](security/tee-checklist.md).

## The WeChat run (2026-10-20, a real iPhone)

One account, [`0xd157b7fd428bfe7217ea9d013fe9017774678731`](https://sepolia.basescan.org/address/0xd157b7fd428bfe7217ea9d013fe9017774678731) (a Safe7579 account onboarded on the server with a passkey), linked to the WeChat mini program on an iPhone. The payment refused, the approval and the execution share one callHash, `0x601c4ae866e0b7e3a3b4d0ff5c3264024ce27bf7b54f446e6e89c10647335745`. The account's own transactions (mandate, link, refusal, approval, payment) were sent by Praetor's bundler (`0xd76eef0179d98f9aeaaad1f26d05d2425e2c9915`), and the payment's user operation was sponsored by the paymaster; the attester's activation and the KYA came through WeCross (to the WeCrossProxy, from `0xbD644c848D5eCD335725F0cBC51F1E04dC153C66`).

| Time (UTC) | Step | On Base | Transaction |
|---|---|---|---|
| 00:21:00 | The bank activates the soter-attester (above), through WeCross | `AttesterApplied`, measurement `0x7328c4f3...ac150469`, active | [`0x58cafa3e...4b9f3c24`](https://sepolia.basescan.org/tx/0x58cafa3eeb77dd5c6cccc2c5d5586e92b2fe4be3837dda5d7931c3f24b9f3c24) |
| 00:28:16 | The bank's KYA for the account's agent key, through WeCross | `KYAApplied`, agent measurement `0x0263abb5...85f9f8d2` | [`0xdccb5c43...2056aee0`](https://sepolia.basescan.org/tx/0xdccb5c433526c782f7c61806d7b95cc74d90a80e153ca5e8fdbc119a2056aee0) |
| 00:28:36 | The owner sets the mandate with the passkey | `OwnerActionApplied` SET_POLICY (0), authKind PASSKEY; `PolicySet` | [`0xa92215aa...a5bbd6d8`](https://sepolia.basescan.org/tx/0xa92215aa4297750213f8207f4e47b4f12a4f1268b04df059ce203952a5bbd6d8) |
| 00:33:04 | The owner updates the mandate with the passkey | `OwnerActionApplied` SET_POLICY (0), authKind PASSKEY; `PolicySet` | [`0x93843b33...c5972fee`](https://sepolia.basescan.org/tx/0x93843b330f19da6d91eba3fa1c9d3136f2958e9ed8d449df6510107bc5972fee) |
| 00:52:44 | WeChat linked: the owner's passkey signs the link, whose payload carries the mini program's SOTER proof signed by the attester | `OwnerActionApplied` LINK_WECHAT (3), authKind PASSKEY | [`0x3312a0ea...7f22469a`](https://sepolia.basescan.org/tx/0x3312a0eab7c673060910f0dbcfc91d0992eaa0aaa6fae47dd6731dab7f22469a) |
| 00:54:48 | A payment to a new payee: refused on-chain, and the approval request goes to WeChat (T2) | `Refused` UNKNOWN_PAYEE (reason 7), tier T2 | [`0x2ef41395...83a945ab`](https://sepolia.basescan.org/tx/0x2ef4139547686147528a899d01e09e974c93184f849e0378809b786683a945ab) |
| 00:55:32 | The owner approves with Face ID inside WeChat (SOTER); the attester checks the signature with Tencent in its Phala CVM and signs the approval | `ApprovalRegistered`, authKind SOTER (1) | [`0x9a6633db...f5b3ee18`](https://sepolia.basescan.org/tx/0x9a6633dbb93fff0d6694b737a503aa8fbdbf2e26e9305a1e48187ecef5b3ee18) |
| 00:55:36 | The approved payment executes once: 1.00 USDC on chain (100 USDC in the story) to `0x000000000000000000000000000000000000c0fe` | `ApprovalConsumed`; `Decision` OK, tier T2; USDC `Transfer` of 1,000,000 units | [`0x0a900425...689b1ab2`](https://sepolia.basescan.org/tx/0x0a90042508153fe9e283fa59b3186f507ce022706416b10245cbe3bf689b1ab2) |

## Check it yourself

Read-only, against any Base Sepolia RPC:

```bash
RPC=https://base-sepolia-rpc.publicnode.com
cast receipt --rpc-url $RPC 0x0a90042508153fe9e283fa59b3186f507ce022706416b10245cbe3bf689b1ab2   # status 1, ApprovalConsumed, Decision, Transfer
cast call --rpc-url $RPC 0x6411cc907Ace53F1Bdf8607a85991d3b38E79a5f \
  "attesterOf(address)(bytes32,bool)" 0xd690B2E7312082D48d7667f78FD04482bE91b846   # the soter-attester's compose hash, true
```
