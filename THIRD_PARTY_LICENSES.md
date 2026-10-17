# Third-party licences

Praetor itself is all rights reserved (see `NOTICE`). Each entry below keeps its own licence. Deployed-only contracts are called through our own interfaces and never copied into this repository.

| Component | Licence | How it is used |
|---|---|---|
| Coinbase webauthn-sol, FreshCryptoLib, solady | MIT | vendored in `contracts/base/lib` (M2) |
| OpenZeppelin Contracts | MIT | library (M2) |
| forge-std | MIT / Apache-2.0 | test library |
| viem | MIT | dependency |
| @noble/hashes | MIT | dependency; its keccak is bundled into `apps/miniprogram/miniprogram/lib/protocol.js` with its licence comment (M14) |
| esbuild | MIT | build tool of the mini program bundle (M14) |
| @simplewebauthn | MIT | dependency (M9) |
| web-push | MPL-2.0 | unmodified dependency (M9) |
| three, @react-three/fiber, drei | MIT | dependency (M13) |
| OpenCode | MIT | container (M8) |
| ant-intl-alipayplus-mcp | MIT | container (M10) |
| @phala/dstack-sdk | Apache-2.0 | dependency (M7) |
| FISCO BCOS, WeIdentity, WeBASE, WeCross, BCOS3 stub | Apache-2.0 | containers and builds (M4 to M12) |
| WeCross router, account manager, BCOS3 stub, proxy (vendored) | Apache-2.0 | `praetor/wecross` image, `contracts/base/src/vendor/wecross`, one patched account manager class |
| Safe | LGPL-3.0 | deployed contracts only, unmodified |
| Safe7579 adapter and launchpad, Rhinestone registry | GPL-3.0 | deployed contracts only, own interfaces |
| xmllint-wasm (libxml2) | MIT | npm dependency of the api (camt.053 schema check) |
| ISO 20022 camt.053.001.02 schema | ISO 20022 (free to use) | `services/api/assets/`, unmodified |
| DeepSeek models | DeepSeek License | through OpenCode Zen |
| Caddy, MySQL, Foundry images | Apache-2.0, GPL-2.0, MIT / Apache-2.0 | container images, unmodified |

Updated as dependencies land (M17 reconciles it with `docs/security/deps.md`).
