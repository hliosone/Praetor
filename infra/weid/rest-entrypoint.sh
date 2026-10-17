#!/bin/bash
# Starts the REST service with the deployment's SDK configuration (written by weid-deploy) and the admin key file.
set -euo pipefail
cp /weid/out/conf/* /app/conf/
# The node address recorded at deployment may not be routable from this network.
[ -n "${FISCO_CHANNEL:-}" ] && sed -i "s#^nodes=.*#nodes=${FISCO_CHANNEL}#" /app/conf/weidentity.properties
install -m 600 /weid/out/private_key /app/private_key
mkdir -p /weid/keys && rm -rf /app/keys && ln -s /weid/keys /app/keys
exec java -Dfile.encoding=UTF-8 -Djdk.tls.namedGroups=secp256r1,secp256k1 -Xmx512m -cp 'conf/:apps/*:lib/*' com.webank.weid.http.Application
