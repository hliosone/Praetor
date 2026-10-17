# V2: FISCO BCOS 3.17.1 in Docker (auth mode, both profiles)

Run 2026-10-17 03:47 to 04:10 UTC.

## What was run

1. `docker pull fiscoorg/fiscobcos:v3.17.1` (failed, see below), then our own image: `Dockerfile` (debian:bookworm-slim + the release binary `fisco-bcos-linux-x86_64.tar.gz`, sha256 `28eb054b...3cbb` checked against the GitHub release digest). Binary: version 3.17.1, commit `b29d0cbe161e2cb743aba89967c71fc4160dc9bb` (the same commit Alex ran natively), statically linked.
2. `gen.sh`: `build_chain.sh` v3.17.1 (sha256 `ed667e1e...dbe7`) with `-l 10.88.20.10:1,...,10.88.20.13:1 -a <LOCAL_BANK_FISCO address> -e fisco-bcos`, then web3 RPC enabled on `0.0.0.0:8545` in each `config.ini`. One container per node on a private network with fixed IPs (`compose.yml`, project `p0v2`).
3. `probe.ts` (viem) against node0's web3 RPC: EVM facts, governance bootstrap, deploy ACL, `eth_getLogs` behaviour.
4. Guomi profile: `SM=1 OUT=nodes-sm SUBNET_PREFIX=10.88.21 gen.sh` (`build_chain.sh -s`), `compose.sm.yml` (project `p0v2sm`), `probe-sm.ts`, and FISCO console v3.8.0 (Java SDK 3.8.0, sha256 `255f1b67...6d1a`) in `eclipse-temurin:11-jdk` (`sha256:e25e6f22...8ee3`) to deploy and call `HashProbe` with an SM2 account.

## What we saw

| Check | Result |
|---|---|
| Docker Hub image `fiscoorg/fiscobcos:v3.17.1` | **does not exist** (newest tag v3.12.1, Nov 2024) |
| Own image, 4 containers, PBFT | up in < 10 s, `net_peerCount` 4, blocks produced on each tx |
| Docker flag | `build_chain.sh` 3.17.1 uses **`-D`** for docker mode; `-d` is now the CA path for `expand` (spec 04/10 say `-d`) |
| Auth mode | `config.genesis`: `is_auth_check=true`, `auth_admin_account` = bank FISCO address |
| Deploy ACL before setup | open: a non-governor (deployer) deploys (as Alex found) |
| Governance bootstrap via `CommitteeManager` `0x...10001` | admin alone: `createUpdateGovernorProposal` for regulator and operator pass on creation; `createSetRateProposal(51,51)` also passes on creation (genesis rates are 0 = "always succeed"); afterwards every proposal needs a second governor vote |
| Deploy ACL whitelist | `createSetDeployAuthTypeProposal(1)` + vote, `createModifyDeployAuthProposal(deployer,true)` + vote: `deployType()=1`; deployer deploys, a random key reverts; the admin itself has no deploy right unless opened |
| `block.timestamp` | milliseconds in the EVM (`1792209107799`), seconds in the RPC block header |
| `block.chainid` / `eth_chainId` | 20200 / 20200 |
| keccak256 (non-SM) | equals viem's keccak256 |
| ecrecover | recovers a secp256k1 signature made off-chain (Base-signer key) |
| Legacy tx, `gasPrice: 0` | works; accounts need no balance |
| `eth_getLogs` without `topics` | error "Missing or invalid parameters" |
| `eth_getLogs` range | **only the first 10 blocks of the range are scanned, the rest is silently dropped**: [12,21] 10 logs, [12,23] still 10 logs (blocks 12-21), [10,23] 8 logs (blocks 12-19), [0,23] 0 logs. Alex's note "returns [] when span > 10" is the visible effect when the events sit after the first 10 blocks |
| `eth_call` without `to` (creation simulation) | not supported (error or `0x`) |
| Resources | about 20 MiB RSS per node, but about 20 to 30% of one CPU per node while idle (8 nodes running = about 2 CPUs) |
| SM chain: web3 RPC | answers `eth_chainId` (20200) and `eth_blockNumber` |
| SM chain: Ethereum-signed tx via web3 RPC | rejected ("internal error") |
| SM chain: console (Java SDK 3.8.0, SM2 account) | deploy and call work against 3.17.1 |
| SM chain: SHA3 opcode | `keccak256("abc")` returns `0x66c7f0f4...a8e0` = **SM3("abc")** |
| SM chain: selectors | `k()` selector is `0xb9ab754b` (SM3), keccak would be `0xb4f40c61` |

## Verdict

**FALLBACK (own image from the release binary)**: everything the spec needs from the non-SM chain works in Docker, including auth mode, governor bootstrap and the deploy ACL. Guomi profile limited as spec 04 already plans: viem/web3 RPC can read but cannot sign; signing needs the Java SDK (or console) with SM2 accounts; SHA3 and selectors are SM3, so EIP-712 digests cannot be computed on FISCO in SM mode.

## Traps for the build

1. `fiscoorg/fiscobcos:v3.17.1` does not exist: `infra/fisco/Dockerfile` builds from the release binary (pinned by sha256).
2. Docker mode flag is `-D`, not `-d`. We do not use build_chain's docker mode anyway (it runs `--network=host`); compose runs one container per node on fixed IPs because `nodes.json` holds IP:port.
3. `eth_getLogs`: always `address` + `topics` + explicit `toBlock`, and ranges of at most 10 blocks starting at `fromBlock` (`packages/fisco-client` chunking).
4. Genesis committee rates are 0: the bootstrap must set rates (51/51) **after** adding the governors, otherwise the first proposal already needs votes from governors that do not exist yet; order: add regulator, add operator, set rates, then ACL proposals with a second vote.
5. In the Guomi profile, the governance admin passed to `-a` must be the bank's **SM2** account address (an SM3-derived address); a secp256k1 address there would be an admin nobody can use.
6. Idle CPU of PBFT nodes is noticeable (about 25% of a core each); the prod server (4 vCPU) carries 4 nodes, about one core.
