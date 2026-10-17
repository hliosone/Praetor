#!/usr/bin/env bash
# Runs spike.Scenario with the WeIdentity SDK config of the running REST service
# ($WEID_HOME/WeIdentity-Rest-Service/dist/conf: fisco.properties, weidentity.properties, SDK certs).
# Nothing is copied: cwd = that dist dir because sdk.cert-path=conf is cwd-relative.
set -euo pipefail
WEID_HOME=${WEID_HOME:-$HOME/weid}
source $WEID_HOME/env.sh
J=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE=${1:?state.properties}
OUT=$(dirname "$STATE")
if [[ ! -d $J/build/install/weid-spike/lib || -n "$(find $J/src $J/build.gradle -newer $J/build/install/weid-spike/lib/weid-spike.jar 2>/dev/null)" ]]; then
  (cd $J && $WEID_HOME/.gradle/wrapper/dists/gradle-6.8-bin/*/gradle-6.8/bin/gradle -q --offline installDist 2>&1 \
     || $WEID_HOME/.gradle/wrapper/dists/gradle-6.8-bin/*/gradle-6.8/bin/gradle -q installDist)
fi
cd $WEID_HOME/WeIdentity-Rest-Service/dist
exec java -Dfile.encoding=UTF-8 -Djdk.tls.namedGroups=secp256r1,secp256k1 \
  -Dlog4j.configurationFile=$J/log4j2.xml -Dspike.log=$OUT/java_sdk.log \
  -cp "conf/:$J/build/install/weid-spike/lib/*" spike.Scenario "$STATE"
