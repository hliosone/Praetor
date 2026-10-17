# Third-party licences

Praetor itself is all rights reserved (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). Every component below keeps its own licence. This list was reconciled with the code as built in M17 (dependency audit: [docs/security/deps.md](docs/security/deps.md)); code reused from the team's earlier projects is listed in [docs/PREEXISTING.md](docs/PREEXISTING.md).

## GPL boundary

No GPL or LGPL source is part of Praetor's own tree: every Solidity file of `contracts/base`, `contracts/fisco` and `packages/protocol/sol` is `UNLICENSED` (ours), except the vendored WeCross proxy (Apache-2.0, below). The 51 sources compiled into the Base contracts are 26 `UNLICENSED`, 24 MIT and 1 Apache-2.0. GPL-licensed contracts are only **deployed and called through our own interfaces** (`contracts/base/src/interfaces/`): Safe (LGPL-3.0), Safe7579 adapter and launchpad, Rhinestone registry and the ERC-4337 EntryPoint v0.7 (GPL-3.0). The pinned submodules under `contracts/lib` contain GPL-3.0 files only in their own test and extension folders (`ds-test`, `solady/ext`, `FreshCryptoLib/solidity/external` and `tests`), which nothing in Praetor imports.

## Solidity libraries (pinned git submodules under `contracts/lib`, D18; never copied into our tree)

| Component | Licence | Used for |
|---|---|---|
| Coinbase webauthn-sol (`619f20a`) | MIT | `WebAuthn.verify` for passkeys (PasskeyValidator, owner auth in MandateHook) |
| FreshCryptoLib | MIT | P-256 fallback when the RIP-7212 precompile is absent (forge tests) |
| solady | MIT | `LibString` (imported by webauthn-sol) |
| OpenZeppelin Contracts (the copy nested in webauthn-sol) | MIT | `ECDSA`, `MessageHashUtils`, `Strings`, `Ownable`, `ERC20`, `SafeERC20`, `Base64` |
| forge-std v1.17.0 | MIT / Apache-2.0 | tests only |

## Vendored or patched third-party code (in this repository)

| File | Origin | Licence | Change |
|---|---|---|---|
| `contracts/base/src/vendor/wecross/WeCrossProxyEVM.sol` | WeCross-BCOS3-Stub v1.4.0 `WeCrossProxy.sol` | Apache-2.0 | BFS precompile replaced by an owner-set name map, pragma 0.8 (NOTICE header in the file) |
| `infra/wecross/patches/account-manager/Default.java` | WeCross-Account-Manager v1.4.0 | Apache-2.0 | adds the "EVM" chain account type (NOTICE header in the file) |
| `wecross/evm-stub/` (structure only) | WeCross-Stub-Dev-Template and the stub SPI `wecross-java-stub` 1.4.0 | Apache-2.0 | factory, driver, connection and account split of the template; all code new |
| `scripts/wecross/router.ts` (login) | WeCross-Java-SDK `RequestUtility.buildLoginParams` | Apache-2.0 | login protocol reimplemented in TypeScript |
| `services/api/assets/camt.053.001.02.xsd` | ISO 20022 | ISO 20022 terms (free to use) | unmodified |
| `spikes/V4-wecross/evm-proxy/WeCrossProxy.bcos3.orig.sol.txt`, `spikes/V9-webase/webase-front-v3.1.1-no-scaffold.patch` | WeCross, WeBASE-Front | Apache-2.0 | Phase 0 spike material only |

## npm production dependencies (exact versions from `pnpm-lock.yaml`)

All 264 packages of the production tree are MIT (231), ISC (16), Apache-2.0 (10), BSD-3-Clause (5), BSD-2-Clause (1) or 0BSD (1) (`pnpm licenses list --prod`, M17). Direct dependencies:

| Package | Version | Licence | Used by |
|---|---|---|---|
| viem | 2.57.5 | MIT | every chain-facing package and service, web app |
| express | 4.21.2 | MIT | every HTTP service |
| zod | 3.25.76 | MIT | configuration and request validation |
| pino | 9.14.0 | MIT | service logs |
| drizzle-orm | 0.44.7 | Apache-2.0 | `packages/db`, member-kit, bundler |
| mysql2 | 3.15.3 | MIT | `packages/db` |
| @modelcontextprotocol/sdk | 1.30.1 | MIT | mcp (server), payout-partner (stdio client of the Alipay+ MCP server) |
| @noble/curves, @noble/hashes | 1.9.1, 1.8.0 | MIT | protocol, member-kit (P-256, hashing); @noble/hashes' keccak is bundled into `apps/miniprogram/miniprogram/lib/protocol.js` with its licence comment |
| esbuild | 0.28.2 | MIT | build tool of the mini program bundle (M14) |
| web-push | 3.6.7 | MPL-2.0 (unmodified) | notifier (Web Push to the owner's devices, VAPID) |
| @simplewebauthn/server | 13.3.3 | MIT | api (passkey registration and sign-in) |
| @simplewebauthn/browser | 13.2.2 | MIT | web app |
| @phala/dstack-sdk | 0.5.8 | Apache-2.0 | agent-signer, soter-attester |
| xmllint-wasm (libxml2) | 5.3.0 | MIT | api (camt.053 schema check) |
| react, react-dom | 18.3.1 | MIT | web app |
| react-router-dom | 6.30.6 | MIT | web app |
| three | 0.170.0 | MIT | web app (Phone3D) |
| @react-three/fiber, @react-three/drei | 8.17.10, 9.117.3 | MIT | web app (Phone3D) |
| qrcode | 1.5.4 | MIT | web app (WeChat link QR) |

`web-push` (MPL-2.0), listed by spec 09, is not a dependency of the build at M17.

## Containers and builds (unmodified, pinned by digest or sha256)

| Component | Licence | How it is used |
|---|---|---|
| FISCO BCOS 3.17.1 (release binary, `build_chain.sh`) | Apache-2.0 | own image `praetor/fisco-bcos:3.17.1` (`infra/fisco`) |
| WeIdentity Build-Tools `e80d870`, REST service `437042e`, weid-java-sdk 3.1.1-rc.2 | Apache-2.0 | `infra/weid`, `services/identity/weid-helper` |
| WeCross router, account manager 1.4.0, BCOS3 stub | Apache-2.0 | `praetor/wecross` image (`infra/wecross`) |
| log4j 2.20.0 | Apache-2.0 | weid-helper logging |
| junit 4.13.2 | EPL-1.0 | EVM stub tests only |
| dstack simulator 0.5.3 | Apache-2.0 | `infra/dstack-sim` (local TEE stand-in) |
| OpenCode (`opencode-ai` 1.19.3) | MIT | agent-runner image |
| ant-intl-alipayplus-mcp 1.0.1, `mcp[cli]` 1.29.1 | MIT | payout-partner image |
| Caddy 2.10.2 | Apache-2.0 | reverse proxy |
| MySQL 8.4.6 | GPL-2.0 | database container, used over the network |
| Foundry 1.7.1 (anvil) | MIT / Apache-2.0 | local fork of Base Sepolia |
| Node 22.22.0, Debian bookworm-slim, Eclipse Temurin 8 / 11, Gradle, uv (Python 3.12) | various (MIT, GPL-2.0 with the Classpath exception for the JDK, Apache-2.0) | base images |
| gitleaks 8.28.0 | MIT | secret scan in `make test` |
| FISCO console 3.8.0 (Java SDK 3.8.0, bcos-sdk-jni, solcJ with FISCO's SM solc 0.8.26) | Apache-2.0 | downloaded by `make smoke-sm` (sha256-pinned), run in the pinned JDK image, never committed (M15 Guomi smoke) |

## Deployed contracts and services we only call

| Component | Licence | How it is used |
|---|---|---|
| Safe | LGPL-3.0 | deployed, unmodified (the account's base) |
| Safe7579 adapter and launchpad, Rhinestone registry | GPL-3.0 | deployed, own interfaces |
| ERC-4337 EntryPoint v0.7 | GPL-3.0 | deployed, own interface |
| Circle USDC (FiatToken v2.2) | Circle's terms | deployed token on Base Sepolia |
| DeepSeek models | DeepSeek License | through OpenCode Zen |
| Pyth Hermes | Pyth data terms | price API (seeded DEMO prices until `PYTH_API_KEY` is set) |
