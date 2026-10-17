# Smoke runs

One-off runs of the product path outside the automated suites (the generated transaction evidence is in EVIDENCE.md).

## Agent with the real model (M8 smoke, local fork, 2026-10-17)

`pnpm exec tsx scripts/demo/smoke-real-model.ts` on a freshly onboarded account (KYC through the demo provider, agent key in agent-signer on the dstack simulator, KYA built by the bank). Model `opencode/deepseek-v4.1-flash-free` through OpenCode 1.19.3, built-in tools locked (Q34).

| Prompt | What the agent did | Result |
|---|---|---|
| "Pay the café 12.50" | `praetor_get_mandate`, `praetor_get_status`, `praetor_pay(Café, 12.50)` | T1, paid 12.50 USDC to Café Lumen, 16 s end to end ("Paid 12.50 USDC to Café Lumen. Tx: ...") |

The automated suites use the scripted model for determinism (F4, F5, tool lockdown, I9); this run shows the product path with the real model. The red-team suite with the real model is M16.

## Guomi profile (M15 smoke, 2026-10-17)

`make smoke-sm` (`infra/fisco/sm/run.sh`), last run 2026-10-17 20:09 to 20:12 UTC: 3 min 11 s with WeIdentity (warm Gradle cache), 45 s for the chain part alone (`SKIP_WEID=1`); the same results on each of the three full runs. Separate from `make test`: it needs Docker and a few minutes. Every run starts from nothing (fresh test-only keys, fresh chain) and removes its containers and network at the end; everything generated stays in `.run/sm` (git- and docker-ignored). Decisions: D55 to D59.

### What runs

1. `contracts/fisco/sm/assemble.sh`: the SM build of the FISCO contracts (main sources + `opaque-board.patch`, D55), also tested by Foundry (profile `sm`, 8 tests) in `make test`.
2. In the pinned JDK 11 image, without network: FISCO's SM solc (from the console's solcJ jar) compiles the SM build and `SmProbe.sol` (paris, optimizer 200, no metadata), `javac` builds the smoke (`infra/fisco/sm/smoke`), `keygen` creates SM2 FISCO accounts (bank, regulator, operator, deployer, WeIdentity admin, stranger, router, relayer) and secp256k1 Base signers, then the self-test.
3. `build_chain.sh -s` (through `infra/fisco/gen.sh`, SM=1) with `-a` = the bank's SM2 address, 4 sealers on 10.97.0.10-13 in compose project `praetor-sm`, nodes from the stack image.
4. The Java SDK smoke on that chain (`SmSmoke smoke`), then WeIdentity (`infra/fisco/sm/weid.sh`).

### Versions and digests

| Item | Version | Digest |
|---|---|---|
| FISCO BCOS node | 3.17.1 release binary, image `praetor/fisco-bcos:3.17.1` (the stack's) | binary sha256 `28eb054b...3cbb`, image `sha256:30e0b1de30ff...` |
| `build_chain.sh` | v3.17.1 (`-s`: SM2, SM3, SM-TLS) | sha256 `ed667e1e...dbe7` |
| TASSL used by `build_chain.sh` for SM certificates | tassl-1.1.1b, installed by `build_chain.sh` in `~/.fisco` (already there from Phase 0; the main profile's run uses it too) | sha256 `1e10d865...d0dc` |
| FISCO console (Java SDK and SM solc source) | 3.8.0: `fisco-bcos-java-sdk-3.8.0`, `bcos-sdk-jni-3.7.0`, `webank-blockchain-java-crypto-1.0.3`, `solcJ-1.0.0` | tarball sha256 `255f1b67...6d1a` |
| FISCO SM solc | `0.8.26-develop.2024.6.20+commit.d419ca2a` (solcJ `native/sm/linux/0.8.26`) | sha256 `b0a935b9...fc92` |
| JDK image | eclipse-temurin 11 | `sha256:e25e6f22...8ee3` |
| WeIdentity | Build-Tools `e80d870` (3.1.1-rc.2), REST `437042e` (1.7.0, patched as in V3), the stack's images | |
| MySQL (WeIdentity's, tmpfs) | 8.4.6 | `sha256:86921892...ebc6e9` |

### Self-test (no chain): 11 PASS

| Check | Result |
|---|---|
| SDK SM3("abc") = the GB/T 32905 value `66c7f0f4...a8e0`; the ECDSA suite hashes with keccak256 | PASS, PASS |
| Off-chain Base digest of the Status and Anchor golden vectors (typehash, struct hash, digest) | PASS, PASS |
| Java SDK secp256k1 signatures over those digests are byte-identical to the vectors (RFC 6979, low s, v 27/28) | PASS, PASS |
| SM2 binding: round trip, FISCO address = SM3(public key)[12..32], refused for another Base signer, for another SM2 key and when tampered | 5 PASS |

### On the SM chain: 35 PASS, 0 FAIL, 5 INFO

| Area | Check | Result |
|---|---|---|
| Chain | SDK over SM-TLS, chain in SM crypto mode (cryptoType 1), auth mode on, 4 sealers, FISCO accounts on `sm2p256v1` | 4 PASS |
| Governance (Q22) | Genesis committee = the bank's SM2 account alone (its first proposal passed on its own vote); governors bank, regulator, operator; rates 51/51; deploy whitelist on (`deployType 1`) with deployer and WeIdentity admin only | 3 PASS |
| Deploy ACL | A deploy from an account outside the whitelist is refused (status 18); so is one from the governance admin itself | 2 PASS |
| SM solc | `sign(uint256,bytes)` compiles to selector `383a8074` = SM3 of the signature (keccak would be `9b3d270a`) | PASS |
| Deployment | MemberRegistry, BaseOutbox, the 7 boards and SmProbe deploy with SM2-signed transactions from the whitelisted deployer; outbox sealed | PASS |
| MemberRegistry binding | Each member's binding verifies before submission; a binding signed by another SM2 account is refused before submission; after `bootstrap`, `memberOf` returns each member with a 128-byte binding that verifies against the stored FISCO account and Base signer; `roleOf` works; `domainSeparator()` reverts `DomainOffChain` | 5 PASS |
| Status attestation (AgentStatus) | Freeze opened by the regulator: nonce 1, threshold 1, `fiscoRef` = SM3(abi.encode(board, id)); `digestOf` reverts `DigestOffChain`; a non-member SM2 account cannot submit (NotMember); the regulator's signature (Base digest computed off-chain, checked by the submitter first) makes it Ready, stored under its Base signer; `statusOf` = FROZEN; the outbox holds the attestation bytes and the opaque signature, and replaying Base's checks off-chain (keccak digest, ecrecover, member, threshold) accepts them | 8 PASS |
| Loosening | Unfreeze opened by the bank: threshold 2, nonce 2; a second submission by the same member is refused (AlreadySigned); with bank and operator it is Ready, signers ascending, each signature recovering to its signer, Base would accept; `statusOf` = ACTIVE, 2 outbox messages | 4 PASS |
| AuditLog | Only the operator appends (OnlyOperator); the on-chain head is the SM3 chain of the entry hashes and differs from the main profile's keccak head for the same entries (audit vector); an anchor (seq 1, that head) is Ready with the operator's and the bank's signatures, which Base would accept | 4 PASS |
| SM3 facts | The SHA3 opcode computes SM3 (`keccak256("abc")` in Solidity returns `66c7f0f4...`); the dispatcher answers the SM3 selector and refuses the keccak one | 2 PASS |
| Member change | The old binding does not cover a new Base signer (refused before submission); a 2-of-3 `setMember` with a fresh binding stores the operator's new Base signer, and the binding verifies | 2 PASS |
| INFO | Native RPC `call` to the genesis committee contract at block 0 returns empty with status 0 (it answers from block 1: the smoke reads governance after the first proposal) | recorded |
| INFO | Crypto precompile `0x100a`: `keccak256Hash("abc")` = keccak256, `sm3("abc")` = SM3; `ecrecover` recovers the secp256k1 signer; `sm2Verify` accepts the bank's binding and returns the bank's FISCO account | recorded |

### WeIdentity on the SM chain (recorded, not a gate)

`infra/fisco/sm/weid.sh`, on the same chain after the Java smoke (D59): WeIdentity-Build-Tools `e80d870` (3.1.1-rc.2) with `sm_crypto=1` and the SM SDK certificates, the smoke's SM2 WeIdentity admin (whitelisted by the governance step), then WeIdentity-Rest-Service `437042e` (1.7.0, the stack's image) and Alex's 43-step scenario (the stack's `praetor/weid-scenario:local`, unchanged).

| Step | Result |
|---|---|
| Build-Tools compile and deploy (5 contracts + system CPTs, admin WeID = the admin's SM2 address) | PASS, 116 s with a cold Gradle cache |
| REST service up, `createWeId` | PASS (`errorCode 0`, `did:weid:101:0x...`) |
| Scenario a to k | **39 PASS, 4 FAIL, 1 INFO**. PASS: WeIDs, authority issuer registration and recognition, both CPTs, PersonKYC and AgentMandate credentials, verification over REST and SDK, multi-signature (`addSignature`), selective disclosure, evidence create/get/revoke, issuer whitelist, the negative checks (non-admin recognition, tampered and expired credentials), user-controlled DID document updates (j4), web3 reads. FAIL: e3, e4, e5, e5-rest, the agent's own DID document updates signed with its secp256k1 key ("the private key does not match the current weid"): the SDK treats keys as SM2 on an SM chain (BLOCKERS B3). INFO: verify ignores revocation (same as non-SM, V3) |

### What does not work in SM mode, and why

- **viem and the web3 RPC cannot send transactions** (V2): an SM chain accepts only SM2-signed transactions, so every TypeScript service that writes to FISCO through viem (`packages/fisco-client`, member services, bridge-relayer, the deploy script) cannot run against it. The Guomi profile is this smoke through the Java SDK, not a second running stack; the web3 RPC still serves reads (WeIdentity's deploy script uses it).
- **No EIP-712 on FISCO with the SHA3 opcode**: SHA3, selectors, event topics and constant `keccak256` folding are SM3, so a board cannot compute Base's digest. The boards store signatures as opaque bytes (spec 04), `digestOf` and `domainSeparator` revert, member services compute the digest off-chain from `domainName` and `baseHook`, and Base verifies. Not an impossibility: the precompile's `keccak256Hash` and `ecrecover` work (INFO above), so on-chain verification would be possible with a precompile-based PraetorTypes (D58, not done).
- **SM3 values where the main profile has keccak**: `fiscoRef`, board keys, the `policyHash` emitted by `MandateChecked`, and the AuditLog head (so an anchored head is the SM3 chain; `/api/audit/verify` recomputes with keccak and would need SM3 in this profile).
- **Only members submit signatures**: the main profile's boards accept a signature from any sender (ecrecover attributes it); the SM build attributes it to the sending member's FISCO account, so a relayer cannot submit on a member's behalf.
- **The agent's secp256k1 key cannot maintain its WeID** (4 scenario steps, BLOCKERS B3): the WeIdentity SDK treats keys as SM2 on an SM chain.
- Not run in SM mode: WeCross (router and BCOS3 stub) and WeBASE-Front.

### Traps found

1. FISCO's SM solc is `0.8.26-develop`: semver ranks it below 0.8.26, so `^0.8.26` refuses it (the SM build uses `^0.8.25`).
2. Native RPC `call` at block 0 sees no genesis system contract (empty output, status 0); the web3 `eth_call` answers. Read governance after the first transaction.
3. A Foundry profile sharing `out/` with the default profile overwrites the main artifacts that `pnpm abis` embeds: the `sm` profile has its own `out` and `cache`.
4. `build_chain.sh -s` writes `sm_cert.cnf` and `sm_sm2.param` into its working directory (gen.sh now runs it next to its output).
5. The Java SDK's JNI prints `libproviders.so: cannot open shared object file` at exit (OpenSSL provider probe): harmless.
6. The Java SDK's SM2 signatures are randomised; its secp256k1 ones are deterministic (RFC 6979) and match viem's byte for byte.
