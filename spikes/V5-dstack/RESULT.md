# V5: Phala dstack simulator + @phala/dstack-sdk@0.5.8

Run 2026-10-17 03:52 to 04:00 UTC.

## Commands

```bash
npm i -g phala@1.1.22                       # CLI v1.1.22+4ff72a6
phala simulator start                       # downloads dstack-simulator-0.5.3-x86_64-linux-musl into ~/.phala-cloud/simulator/0.5.3
cd spikes/V5-dstack && npm install          # @phala/dstack-sdk 0.5.8, viem 2.57.5
docker run --rm -v "$PWD":/app -v ~/.phala-cloud/simulator/0.5.3/dstack.sock:/var/run/dstack.sock \
  -e DSTACK_SIMULATOR_ENDPOINT=/var/run/dstack.sock -w /app node:22.22.0-slim node probe.mjs
phala simulator stop && phala simulator start   # then the probe again
```

## Seen

- `phala simulator start` installs and runs **dstack-simulator 0.5.3** in the background (PID in `/tmp/dstack-simulator.pid`, log `~/.phala-cloud/logs/dstack-simulator.log`). It listens on **Unix sockets only** (`dstack.sock` = v0.5 API, `tappd.sock` = legacy v0.3 API, plus `external.sock`, `guest.sock`); the `-p` port option is not used. A container reaches it by bind-mounting `dstack.sock` to `/var/run/dstack.sock`, the same path Phala Cloud mounts in a CVM, so the agent-signer image needs no simulator-specific code.
- `@phala/dstack-sdk@0.5.8` exports **`DstackClient`** (v0.5 API: `getKey(path, purpose, algorithm)`, `getQuote(reportData)`, `info()`, `getTlsKey`, `attest`, `sign`, `verify`, `emitEvent`, `isReachable`, `version`) and **`TappdClient`** (legacy: `deriveKey`, `tdxQuote`). `deriveKey`/`tdxQuote` on `DstackClient` are the deprecated aliases. Helpers: `@phala/dstack-sdk/viem` (`toViemAccount` deprecated, `toViemAccountSecure`), `getComposeHash`, `encrypt-env-vars`. 0.5.8 is the latest published version (no 0.6.x on npm today).
- `getKey("praetor/agent/0xabc/v1", "agent", "secp256k1")` returns a 32-byte key and a 2-element `signature_chain`. Address `0x304E8A3DbAd94499a3Ecf521AFC6A43d576EB48e`. Same key on a second call, **same key after a simulator restart**, a different key for `/v2`. Spec 05's derivation works as written; the 32 bytes are used directly as the secp256k1 private key.
- `getQuote(reportData)`: a `0x...` hex **string** is taken as UTF-8 text and rejected ("Report data is too large, it should be less than 64 bytes"); passing the 32 raw bytes works. The response: `quote` (5006 bytes), `report_data` (64 bytes, our 32 bytes then zero padding), `event_log` (27 entries), `replayRtmrs()` (RTMR0 to RTMR3). The quote contains our report data.
- `info()`: `app_id ea549f02...`, `compose_hash ea549f02e1a25fab...e48b`, `rtmr3 6d1a3da9...`, `mrtd c68518a0...`, `app_name "kvin-nb"`, `key_provider_info` (kms public key). `version()` fails on the 0.5.3 simulator ("Service not found: Version").
- The simulator serves **fixed** material: `appkeys.json` (`k256_key`, ...), `quote.hex`, `app-compose.json` (a Jupyter notebook app named "kvin-nb") and `eventlog.json` ship with the binary. Every simulator install therefore derives the **same** keys and reports the same compose hash; there is no "simulator" flag in `info()` or in the quote.

## Verdict

**PASS** (no fallback needed). Pins: phala CLI 1.1.22, dstack-simulator 0.5.3 (installed by the CLI), `@phala/dstack-sdk` 0.5.8, image `node:22.22.0-slim`.

## Traps (for QUESTIONS.md)

1. Simulator keys are public (fixed `appkeys.json` shipped with the simulator): anyone with the same simulator derives our local agent keys. Default: simulator-derived agent keys are only used with `CHAIN_MODE=fork`; in `local-live` and `rehearsal` they are acceptable on testnet but documented as "publicly derivable", and `PRAETOR_ENV=prod` refuses the simulator (I13).
2. The simulator's compose hash and RTMR3 are constants of the simulator, not of our image, and nothing in the quote says "simulator". Default: `agent-signer` and `soter-attester` report `simulator: true` from their own config (`ATTESTATION_MODE`), bank-service accepts simulator quotes only when `ATTESTATION_MODE=simulator` and checks the report data binding; in prod it verifies through Phala's API plus the RTMR3 compose-hash allowlist.
3. `getQuote` needs raw bytes, not a hex string. Default: the signer passes `hexToBytes(keccak256(address || nonce))`; a unit test pins it.
4. The simulator talks over Unix sockets only. Default: compose mounts `${DSTACK_SOCKET}` at `/var/run/dstack.sock` in the tee-sim profile; `DSTACK_SIMULATOR_ENDPOINT=/var/run/dstack.sock`.
