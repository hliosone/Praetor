#!/bin/bash
# The SDK reads fisco.properties and weidentity.properties from the classpath and the certificates from ./conf.
set -euo pipefail
mkdir -p /app/conf
cp /weid/out/conf/* /app/conf/
# The node address recorded at deployment may not be routable from this network.
[ -n "${FISCO_CHANNEL:-}" ] && sed -i "s#^nodes=.*#nodes=${FISCO_CHANNEL}#" /app/conf/weidentity.properties
install -m 600 /weid/out/private_key /app/private_key
exec java -Dfile.encoding=UTF-8 -Djdk.tls.namedGroups=secp256r1,secp256k1 -Xmx384m \
  -Dlog4j.configurationFile=/app/log4j2.xml -cp 'conf/:lib/*' praetor.weid.Helper
