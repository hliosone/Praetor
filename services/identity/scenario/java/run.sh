#!/usr/bin/env bash
# Runs spike.Scenario (built into the image) with the WeIdentity SDK config written by weid-deploy
# (/weid/out/conf: fisco.properties, weidentity.properties, SDK certs). sdk.cert-path=conf is cwd-relative.
set -euo pipefail
J=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE=${1:?state.properties}
OUT=$(dirname "$STATE")
WORK=$(mktemp -d)
mkdir -p "$WORK/conf" && cp /weid/out/conf/* "$WORK/conf/"
cd "$WORK"
exec java -Dfile.encoding=UTF-8 -Djdk.tls.namedGroups=secp256r1,secp256k1 \
  -Dlog4j.configurationFile=$J/log4j2.xml -Dspike.log=$OUT/java_sdk.log \
  -cp "conf/:$J/lib/*" spike.Scenario "$STATE"
