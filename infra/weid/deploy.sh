#!/bin/bash
# One-shot WeIdentity deployment on the consortium chain (spec 04, V3): Build-Tools at e80d870 (3.1.1-rc.2) with the
# fixed admin key from .env (Q32, opened in the FISCO deploy whitelist by the governance bootstrap). Writes the SDK
# configuration the REST service and the helper share into /weid/out. Idempotent: a deployed chain is left alone.
# WEID_SM=1 targets an SM chain (the Guomi smoke, infra/fisco/sm/weid.sh): sm_crypto=1 and the SM SDK certificates.
set -euo pipefail
OUT=/weid/out
: "${WEID_ADMIN_KEY:?}" "${MYSQL_PASSWORD_WEID:?}" "${FISCO_CHANNEL:?}" "${FISCO_RPC_URL:?}"
sm_crypto="${WEID_SM:-0}"
certs=(ca.crt sdk.crt sdk.key)
[ "$sm_crypto" = 1 ] && certs=(sm_ca.crt sm_sdk.crt sm_sdk.key sm_ensdk.crt sm_ensdk.key)
# The marker holds the chain's genesis hash: a regenerated FISCO chain gets a fresh deployment.
genesis=$(curl -sf -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x0",false]}' "$FISCO_RPC_URL" | jq -r .result.hash)
[ -n "$genesis" ] && [ "$genesis" != null ] || { echo "weid: FISCO not reachable"; exit 1; }
# contracts.json: the deployed addresses (the agent DID updates of agent-signer target the WeId contract).
contracts() {
  python3 - "$1" "$OUT/contracts.json" <<'PY'
import json, re, sys
log = open(sys.argv[1]).read()
names = {'weid': 'weId', 'cpt': 'cpt', 'authority issuer': 'authorityIssuer', 'evidence': 'evidence', 'specificIssuer': 'specificIssuer'}
out = {}
for label, key in names.items():
    m = re.findall(r'%s contract address is (0x[0-9a-fA-F]{40})' % label, log)
    if m: out[key] = m[-1]
json.dump(out, open(sys.argv[2], 'w'))
PY
}
if [ "$(cat "$OUT/deployed" 2>/dev/null)" = "$genesis" ]; then
  [ -f "$OUT/contracts.json" ] || contracts /weid/src/deploy.log
  echo "weid: already deployed"; exit 0
fi
rm -rf "${OUT:?}"/*
SRC=/weid/src/WeIdentity-Build-Tools
if [ ! -d "$SRC/.git" ]; then
  git clone -q https://github.com/WeBankBlockchain/WeIdentity-Build-Tools.git "$SRC"
fi
git -C "$SRC" checkout -q e80d870
cd "$SRC"
cat > run.config <<CFG
blockchain_address=${FISCO_CHANNEL}
blockchain_fiscobcos_version=3
org_id=praetor
amop_id=praetor_amop
chain_id=101
group_id=group0
sm_crypto=${sm_crypto}
persistence_type=mysql
mysql_address=mysql:3306
mysql_database=weid
mysql_username=weid
mysql_password=${MYSQL_PASSWORD_WEID}
redis_address=
redis_password=
cns_profile_active=prd101
CFG
mkdir -p resources/conf
for c in "${certs[@]}"; do cp "/fisco-sdk/$c" resources/conf/; done
export GRADLE_USER_HOME=/weid/gradle
bash compile.sh >/weid/src/compile.log 2>&1 || { tail -40 /weid/src/compile.log; exit 1; }
umask 077
mkdir -p /work
# Build-Tools reads the admin key as a decimal integer; the hex key never leaves the container.
# No trailing newline: GuideService parses the whole file as a BigInteger.
python3 -c "import os,sys;sys.stdout.write(str(int(os.environ['WEID_ADMIN_KEY'],16)))" > /work/admin.key
# Its JVM hangs after a failure (V3): timeout signals the whole process group.
timeout -k 10 300 bash deploy.sh --private-key /work/admin.key >/weid/src/deploy.log 2>&1 || { tail -40 /weid/src/deploy.log; exit 1; }
mkdir -p "$OUT/conf"
cp resources/fisco.properties resources/weidentity.properties "$OUT/conf/"
for c in "${certs[@]}"; do cp "resources/conf/$c" "$OUT/conf/"; done
sed -i 's#^sdk.cert-path=.*#sdk.cert-path=conf#' "$OUT/conf/fisco.properties"
cp /work/admin.key "$OUT/private_key"
chmod 600 "$OUT/private_key"
contracts /weid/src/deploy.log
echo "$genesis" > "$OUT/deployed"
echo "weid: deployed"
