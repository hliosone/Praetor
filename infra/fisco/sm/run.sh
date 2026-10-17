#!/bin/bash
# make smoke-sm: the Guomi profile smoke (M15, spec 04). A fresh, disposable SM chain (build_chain.sh -s: SM2
# accounts, SM3, SM-TLS) in its own compose project, the SM build of the FISCO contracts compiled with FISCO's SM solc,
# then the Java SDK 3.8.0 smoke in the pinned JDK 11 image. Everything generated (test keys, chain, build, results)
# lives in .run/sm (git- and docker-ignored); containers and the network are removed at the end, images are kept.
# SKIP_WEID=1 skips the WeIdentity SM attempt.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
work="$root/.run/sm"
JDK=eclipse-temurin:11-jdk@sha256:e25e6f22a886aff4da695ac1a239c0f608ff997622a8c39d754066fffcd58ee3
export SM_CHAIN="$work/chain/nodes" SM_UID="$(id -u)" SM_GID="$(id -g)"
compose=(docker compose -p praetor-sm -f infra/fisco/sm/compose.yml)

cleanup() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f praetor-sm-java >/dev/null 2>&1 || true
  [ -f infra/fisco/sm/weid.sh ] && bash infra/fisco/sm/weid.sh down >/dev/null 2>&1 || true
}
trap cleanup EXIT

jdk() {
  local net="$1"
  shift
  docker run --rm --name praetor-sm-java --hostname localhost -u "$SM_UID:$SM_GID" -e HOME=/tmp --network "$net" \
    -v "$root/infra/fisco/downloads/console:/sdk:ro" -v "$root/infra/fisco/sm/smoke:/src:ro" \
    -v "$root/contracts/fisco/sm/build:/contracts:ro" -v "$root/contracts/lib/webauthn-sol/lib/openzeppelin-contracts:/oz:ro" \
    -v "$root/packages/protocol/vectors:/vectors:ro" -v "$work:/work" "$JDK" bash /src/entry.sh "$@"
}

started="$(date -u +%FT%TZ)"
echo "== smoke-sm $started"
cleanup
rm -rf "$work"
mkdir -p "$work"
bash infra/fisco/fetch.sh console
make --no-print-directory fisco-image
bash contracts/fisco/sm/assemble.sh

echo "== SM build, test keys, self-test (no chain)"
jdk none prepare

admin="$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["bank"])' "$work/keys/addresses.json")"
echo "== SM chain (governance admin = bank SM2 account $admin)"
SM=1 OUT="$SM_CHAIN" FISCO_IPS=10.97.0.10:1,10.97.0.11:1,10.97.0.12:1,10.97.0.13:1 ADMIN="$admin" bash infra/fisco/gen.sh
"${compose[@]}" up -d --wait

echo "== Java SDK smoke on the SM chain"
status=0
jdk praetor-sm smoke || status=$?

if [ "${SKIP_WEID:-0}" != 1 ] && [ -f infra/fisco/sm/weid.sh ]; then
  echo "== WeIdentity on the SM chain"
  bash infra/fisco/sm/weid.sh up || echo "weid: see $work/weid (recorded, not a gate)"
fi

{
  echo "started $started"
  echo "ended $(date -u +%FT%TZ)"
  echo "fisco image $(docker image inspect -f '{{.Id}}' praetor/fisco-bcos:3.17.1)"
  echo "jdk image $JDK"
  echo "sm solc $(tr '\n' ' ' <"$work/solc/version.txt")"
} | tee "$work/run.txt"
exit "$status"
