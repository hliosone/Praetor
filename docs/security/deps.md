# Dependency audit

Run on 2026-10-17 (M17) against the lockfiles of this commit. Licences of every component: [THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).

## How dependencies are pinned

- **npm**: one `pnpm-lock.yaml`, `save-exact=true` and `engine-strict=true` in `.npmrc`, installs with `--frozen-lockfile` (Makefile, every Dockerfile).
- **Solidity**: git submodules under `contracts/lib` pinned to commits (D18).
- **Containers**: every pulled image is pinned by digest; `test/infra/compose.test.ts` ("pins every pulled image by digest") fails otherwise. Locally built `praetor/*` images are never pulled (D31).
- **Binaries**: the FISCO BCOS release and `build_chain.sh` (`infra/fisco/fetch.sh`), the WeCross router and account manager (`infra/wecross/Dockerfile`) and the dstack simulator (`infra/dstack-sim/Dockerfile`) are checked against sha256 values in the repository.
- **Python** (payout-partner image): `ant-intl-alipayplus-mcp==1.0.1` with `mcp[cli]==1.29.1`. **Java**: Gradle coordinates with exact versions (`weid-java-sdk:3.1.1-rc.2`, `log4j 2.20.0`, `junit 4.13.2`); the WeCross EVM stub compiles only against the router's own jars.

## npm: `pnpm audit --prod`

324 production dependencies resolved. **13 advisories: 0 critical, 4 high, 7 moderate, 2 low.** None was upgraded in M17 (a documentation milestone); the last column gives the version that fixes each one.

| Severity | Package (installed) | Advisory | Where | Assessment | Fixed in |
|---|---|---|---|---|---|
| high | @modelcontextprotocol/sdk 1.30.1 | GHSA-6qxp-vccf-f47h: an OAuth **client** can send credentials to an authorization server chosen by the MCP server | mcp (server side), payout-partner (client) | Not reachable. mcp uses the server classes only. payout-partner's client (`services/payout-partner/src/psp.ts`) talks over stdio to the pinned Alipay+ MCP binary in its own container, with no OAuth provider and no HTTP transport. | 1.31.0 |
| high | drizzle-orm 0.44.7 | GHSA-gpj5-g38j-94v9: SQL injection through improperly escaped SQL identifiers | `packages/db`, member-kit, bundler | Not reachable. Table and column names are static in `packages/db/src/schema`; the code has no `sql.identifier` or `sql.raw`. | 0.45.2 |
| high | mysql2 3.15.3 | GHSA-3f6p-5ww8-9rcr: a malicious server can downgrade auth to `mysql_clear_password` and read the password | `packages/db` | Low. Services connect only to the MySQL container on the internal Docker network; exploiting it needs a hostile server inside that network. | 3.22.0 |
| moderate | mysql2 3.15.3 | GHSA-rgwj-5xj2-c3m3: unbounded zlib inflate (decompression bomb) from the server | `packages/db` | Low, same precondition (hostile MySQL server). | 3.23.1 |
| high | path-to-regexp 0.1.12 (via express 4.21.2) | GHSA-37ch-88jc-xwx2: ReDoS through multiple route parameters | every HTTP service (express) | Not established either way. Our routes have at most one parameter per path segment (for example `/proposals/:board/:id` in member-kit, `/api/console/:role/proposals/:board/:id` in api). Upgrade recommended because api routes are public. | 0.1.13 |
| moderate (4), low (1) | qs 6.13.0 (via express) | GHSA-6rw7-vpxm-498p, GHSA-q8mj-m7cp-5q26, GHSA-4mjr-xmp4-gh2g (moderate), GHSA-w7fw-mjwx-w883 (low): denial of service in query-string parsing and stringify | every HTTP service | Reachable as a DoS vector on public routes (api, mcp): express 4 parses every query string with qs. No confidentiality or integrity impact. | 6.16.0 |
| low | body-parser 1.20.3 (via express) | GHSA-v422-hmwv-36x6: an invalid `limit` value silently disables the size check | every HTTP service | Not reachable: every parser uses the default or a valid size string (`16kb` to `24mb`, the largest for the KYC mock's images). | 1.20.6 |
| moderate | react-router 6.30.6 | GHSA-wrjc-x8rr-h8h6: open redirect through a backslash in `<Link>` or `useNavigate` | web app | Not reachable. Navigation targets are fixed routes or server-issued approval ids; no URL from the query string reaches `Link` or `navigate`. | 7.18.0 |
| moderate | react-router 6.30.6 | GHSA-337j-9hxr-rhxg: constructor injection in SSR hydration | web app | Not reachable: the web app is a static single-page app, without server rendering. | 7.18.0 |
| moderate | uuid 9.0.1 (via @react-three/drei) | GHSA-w5hq-g745-h8pq: missing bounds check when a buffer is passed to v3/v5/v6 | web app (3D phone) | Not reachable: no user input reaches drei's uuid calls. | 11.1.1 |

**Recommended follow-up (not done in M17):** upgrade express (or add pnpm overrides) so that qs >= 6.16.0, path-to-regexp >= 0.1.13 and body-parser >= 1.20.6; mysql2 >= 3.23.1; drizzle-orm >= 0.45.2; @modelcontextprotocol/sdk >= 1.31.0. Each upgrade must keep `make test`, `make test-int` and `make e2e` green.

## Secrets: gitleaks

- `make test` runs `scripts/checks/gitleaks.sh` (gitleaks 8.28.0, pinned image, config `.gitleaks.toml`): the whole git history, staged and unstaged changes, and new untracked files.
- Result on 2026-10-17: **no leaks** in the 154 commits of this branch at the end of M17 (history scan run read-only with the repository's `.git` mounted, see the caveat below).
- **Caveat found in M17:** inside a `git worktree` checkout, `.git` is a file pointing outside the mounted directory; the three git-mode scans then fail with "not a git repository" while the script still prints "gitleaks: no leaks" and exits 0. In the main checkout (how `make test` runs on the build machine and in CI) the scans work. The script should fail when gitleaks reports a git error.
- Phase 0 also checked that none of the 72 generated `.env` values appears in `git log -p --all` (`docs/PHASE0.md`).

## Not run in M17

- **OWASP dependency-check** for the Java parts (WeIdentity SDK, log4j 2.20.0, WeCross jars): there is no host JDK and the tool needs the NVD feed. Open item for Phase C (spec 08).
- **pip-audit** for the two Python packages of the payout-partner image.
- **Container image scanning** (for example Trivy) of the pinned base images.
