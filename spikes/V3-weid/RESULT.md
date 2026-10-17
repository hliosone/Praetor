# V3: WeIdentity bundle on the Dockerised FISCO 3.17.1 chain (auth mode, deploy whitelist on), both profiles

Run 2026-10-17 03:56 to 04:27 UTC.

## What was run

Everything Java runs in containers: `Dockerfile.tools` (pinned `eclipse-temurin:11-jdk@sha256:e25e6f22...8ee3` + gettext, git, curl), `Dockerfile.scenario` (+ jq, openssl, xxd, python3). MySQL 8.4 container `p0v3-mysql` at `10.88.20.30` (database `weid`; Build-Tools wants it configured even though blockchain mode creates no tables).

1. WeIdentity-Build-Tools at Alex's commit `e80d870` (VERSION 3.1.1-rc.2), `run.config`: `blockchain_address=10.88.20.10:20200`, version 3, `chain_id=101`, `group0`, `sm_crypto=0`, `cns_profile_active=prd101`; SDK certs from node0. `compile.sh` (Gradle 6.8 wrapper): BUILD SUCCESSFUL.
2. `deploy.sh` with the FISCO deploy whitelist on (V2 left only the deployer opened): refused, FISCO error 18 (permission denied) on the first contract. Build-Tools then **generated a new admin key on the next run** (a whitelist granted to the first one was useless) and **its JVM never exited after the exception** (two containers left running until removed).
3. Fixed admin key: a decimal key file passed with `deploy.sh --private-key <file>`; its address opened through the committee with `open-deploy.ts` (bank proposes, regulator votes, `hasDeployAuth = true`). Deploy: 5 contracts + system CPTs, admin WeID `did:weid:101:0x1497334cc3c3ff3566206651be270625fa686fff`.
4. WeIdentity-Rest-Service at `437042e` (1.7.0) with Alex's one-line patch (`weid-java-sdk:3.1.1-rc.2-SNAPSHOT` to `3.1.1-rc.2`): BUILD SUCCESSFUL. Config: Build-Tools' generated `fisco.properties` and `weidentity.properties`, `sdk.cert-path=conf`, the admin key as `dist/private_key`. Container `p0v3-rest` at `10.88.20.32:6001`. `createWeId` returned `did:weid:101:0x30d6...`, `errorCode 0`.
5. Alex's 43-step scenario (`services/identity/scenario.sh` + `java/` harness, copied to `scenario/`, reference repo untouched), run in the scenario container against the REST container and node0 (`WEID_REST`, `WEB3_RPC`, `WEID_HOME` overrides).
6. Guomi profile: a copy of Build-Tools with `sm_crypto=1`, `blockchain_address=10.88.21.10:20200` (the V2 SM chain, deploy ACL not set there), SM SDK certs (`sm_ca.crt`, `sm_sdk.*`, `sm_ensdk.*`), the same decimal admin key; `compile.sh` + `deploy.sh`.

## What we saw

| Check | Result |
|---|---|
| Build-Tools compile (JDK 11 container) | PASS, 1 min 22 s |
| Deploy under the whitelist, unknown deployer | refused (FISCO error 18), as the deploy ACL intends |
| Deploy after opening the admin's right through the committee | PASS (5 contracts + system CPTs) |
| REST service 1.7.0 (patched) | PASS, `createWeId` ok |
| Scenario a to k, non-SM | **43 PASS + 1 INFO** (identical to Alex's native run). INFO: `verifyCredentialPojo` returns true on a revoked credential, the backend must check the evidence revoked flag (known trap) |
| First scenario attempt | failed only because the container lacked `python3` (used to convert the agent key); fixed in `Dockerfile.scenario` |
| Guomi: Build-Tools compile + deploy on the SM chain | **PASS**: 5 contracts + system CPTs; admin WeID `did:weid:101:0x3a6739f6...` (the same scalar gives a different, SM3-derived address) |
| Guomi: REST + scenario | not run in Phase 0 (M15 scope: SM REST config + SM SDK harness) |

## Verdict

**PASS** on the non-SM profile (deploy, REST, the full 43-step scenario, deploy whitelist respected). **PASS (deploy only)** on the Guomi profile; the SM scenario is left for the M15 smoke, as spec 04 plans ("as far as it goes, recorded").

## Traps for the build

1. Build-Tools generates a new admin key on every run unless `--private-key <decimal key file>` is passed: the WeIdentity admin key must come from `.env` (`*_WEID_ADMIN_KEY`), and its deploy right must be opened through the committee before deploying.
2. Build-Tools' JVM hangs after a deploy exception: run it with a container-level timeout and `docker rm -f` on failure (the shell `timeout` only kills the docker client).
3. The scenario and its tooling need `jq`, `openssl`, `xxd`, `python3`, `column` in the image.
4. The REST service's config is the Build-Tools output plus `sdk.cert-path=conf` (cwd-relative), the admin key as `dist/private_key` with mode 600 and `default.passphrase=private_key`.
5. WeIdentity DID chain id 101 differs from FISCO's 20200 (Alex); in SM mode the same private key maps to a different address.
6. Gradle's user home must point at the shared cache (`GRADLE_USER_HOME`), otherwise every container build re-downloads about 110 MB.
