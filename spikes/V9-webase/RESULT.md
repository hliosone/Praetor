# V9: WeBASE-Front for FISCO BCOS 3.17.1

Run 2026-10-17 04:05 to 04:20 UTC.

## What was run

1. Release zip `webase-front.zip` v3.1.1 from WeBASE's COS bucket (`osp-1257653870.cos.ap-guangzhou.myqcloud.com/WeBASE/releases/download/v3.1.1/webase-front.zip`): **HTTP 403** from this machine (Europe). No GitHub asset for v3.1.1.
2. Docker Hub `webasepro/webase-front:master` (2024-08-09, digest `sha256:30ed4f32...b232f`): bundles `fisco-bcos-java-sdk-2.9.3-SNAPSHOT` and JDK 8, i.e. the 1.5.x line for FISCO 2.x. Not usable for 3.x.
3. Source `WeBASE-Front` tag `v3.1.1` (commit `5fea978`, Apache-2.0; release notes: "supports FISCO-BCOS v3.0.0 and above", adds `auth_check_status`), `./gradlew build -x test` in `praetor/jdk11-tools:p0` (eclipse-temurin 11): **fails**, three `3.3.0-SNAPSHOT` dependencies (`solscaffold`, `WeBankBlockchain-SmartDev-Scaffold`, `solc-gradle-plugin`) only existed on Sonatype OSS staging, which now answers 402.
4. Patched build (`webase-front-v3.1.1-no-scaffold.patch`): drop those three dependencies and the `scaffold` package (the "export a Java project skeleton for a contract" feature, 418 lines removed, nothing else references it). Build succeeds (Java SDK 3.4.0).
5. Run in the JDK 11 container on the chain network (`10.88.20.31`, `conf/application.yml` peers `10.88.20.10:20200`, SDK certs from node0).

## What we saw

| Check | Result |
|---|---|
| `GET /WeBASE-Front/group0/web3/blockNumber` | `87` |
| `GET /WeBASE-Front/group0/web3/groupPeers` | the 4 node ids |
| `GET .../web3/transaction/<hash>` and `transactionReceipt/<hash>` for a viem-sent governance tx | full tx and receipt (status 0, output, gasUsed) |
| `GET .../web3/blockByNumber/2` | block with receipts root and state root |
| UI `GET /WeBASE-Front/` | 200 |
| Note | the path uses the group **name** (`group0`); `/WeBASE-Front/1/...` (2.x style group id) fails |
| Memory | about 714 MiB RSS (JDK 11, defaults) |

## Verdict

**PASS (patched build)**: WeBASE-Front v3.1.1, built from source without the scaffold feature, reads FISCO 3.17.1 (blocks, txs, receipts, peers). The spec's fallback (console-only explorer views) is not needed.

## Traps for the build

1. No downloadable v3.1.1 artifact from here and no 3.x Docker image: `infra/webase/Dockerfile` builds from the pinned tag with this patch (multi-stage, JDK 11), or the build fails on dead SNAPSHOT repositories.
2. Group addressing is by name (`group0`).
3. About 700 MiB RAM: cap with `-Xmx384m` in compose; it sits in the `explorer` profile, behind console auth at `/explorer`, read-only (spec 05).
