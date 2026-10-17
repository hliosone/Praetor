#!/bin/bash
# Runs inside the pinned JDK 11 image (no host JDK, Q5), started by infra/fisco/sm/run.sh with:
#   /sdk (console 3.8.0: Java SDK jars, solcJ), /src (this directory), /contracts (contracts/fisco/sm/build),
#   /oz (OpenZeppelin), /vectors (packages/protocol/vectors), /work (.run/sm, read-write).
# prepare: FISCO's SM solc from solcJ, the SM build of the contracts, the smoke classes, test keys, the self-test.
# smoke:   the on-chain checks (needs the praetor-sm network).
set -euo pipefail
java_run() { java -Dlog4j2.configurationFile=/src/log4j2.xml -cp "/work/classes:/sdk/lib/*" SmSmoke "$1" /work; }
case "$1" in
  prepare)
    mkdir -p /work/solc /work/contracts /work/classes
    (cd /work/solc && jar xf /sdk/lib/solcJ-1.0.0.jar native/sm/linux/0.8.26/solc/solc)
    solc=/work/solc/native/sm/linux/0.8.26/solc/solc
    chmod +x "$solc"
    { "$solc" --version | tail -1; sha256sum "$solc" | cut -d' ' -f1; } >/work/solc/version.txt
    "$solc" --evm-version paris --optimize --optimize-runs 200 --metadata-hash none --no-cbor-metadata \
      @praetor/protocol/=/contracts/protocol/ openzeppelin-contracts/=/oz/ --allow-paths /contracts,/oz,/src \
      --abi --bin --hashes -o /work/contracts --overwrite /contracts/src/*.sol /src/SmProbe.sol 2>&1 | grep -v 'pre-release compiler' || true
    for c in MemberRegistry BaseOutbox AgentStatus AuditLog MandateRegistry SmProbe; do
      [ -s "/work/contracts/$c.bin" ] || { echo "sm smoke: SM solc did not produce $c"; exit 1; }
    done
    javac -nowarn -cp "/sdk/lib/*" -d /work/classes /src/*.java 2>&1 | grep -v '^Note:' || true
    [ -f /work/classes/SmSmoke.class ] || { echo "sm smoke: javac failed"; exit 1; }
    java_run keygen
    java_run selftest
    ;;
  smoke)
    java_run smoke
    ;;
  *)
    echo "usage: entry.sh prepare|smoke" >&2
    exit 2
    ;;
esac
