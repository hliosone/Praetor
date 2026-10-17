#!/bin/bash
# WeCross container (M12). Modes:
#   setup            generate the router and account manager directories under /data (once): zone "payment",
#                    chains fisco (BCOS3 stub, node0's SDK certs) and base (Praetor's EVM stub), the stub admin
#                    account = WECROSS_FISCO_KEY, the account manager's database, admin and RSA key (PKCS#1, V4);
#                    then, on every run, the Base chain config from the current deployment, and WeCrossProxy and
#                    WeCrossHub deployed on FISCO by the stub tool (once)
#   account-manager  run the account manager in the foreground
#   router           run the router in the foreground
# /data holds TLS keys and passwords: it is git-ignored (infra/wecross/generated) and never logged.
set -euo pipefail
ROUTER_IP="${WECROSS_ROUTER_IP:-10.88.0.30}"
AM_IP="${WECROSS_AM_IP:-10.88.0.31}"
R="/data/router"
AM="/data/account-manager"

pem_of_hex() { # secp256k1 hex key -> PKCS#8 PEM on stdout
  local hex="${1#0x}"
  python3 -c "import sys,binascii; sys.stdout.buffer.write(binascii.unhexlify('302e0201010420'+sys.argv[1]+'a00706052b8104000a'))" "$hex" \
    | openssl ec -inform DER -outform PEM 2>/dev/null | openssl pkcs8 -topk8 -nocrypt
}
address_of_hex() { # 0x-address of a secp256k1 hex key: keccak256 of the uncompressed public key, last 20 bytes
  echo "0x$(pem_of_hex "$1" | openssl ec -pubout -outform DER 2>/dev/null | tail -c 64 | openssl dgst -keccak-256 -binary | tail -c 20 | od -An -tx1 | tr -d ' \n')"
}

setup() {
  : "${WECROSS_FISCO_KEY:?}" "${WECROSS_ADMIN_PASSWORD:?}" "${MYSQL_PASSWORD_WECROSS:?}" "${WECROSS_AM_ENCRYPT_KEY:?}"
  local WECROSS_FISCO_ADDRESS
  WECROSS_FISCO_ADDRESS="$(address_of_hex "$WECROSS_FISCO_KEY")"
  if [ -f /data/.ready ]; then echo "wecross: configuration present"; base_chain; deploy_system; return; fi
  rm -rf /data/routers "$R" "$AM"
  # The build tool writes next to itself: run it from a copy the container user owns.
  rm -rf /tmp/wecross-pkg && cp -r /opt/WeCross /tmp/wecross-pkg && cd /tmp/wecross-pkg
  bash build_wecross.sh -n payment -l "${ROUTER_IP}:8250:25500" -o /data/routers >/dev/null
  mv "/data/routers/${ROUTER_IP}-8250-25500" "$R"
  cd "$R"
  # Router RPC without TLS on the internal network only (never published); the account manager login keeps TLS.
  sed -i "s/sslSwitch = .*/sslSwitch = 2/" conf/wecross.toml
  python3 - "$AM_IP" "$WECROSS_ADMIN_PASSWORD" <<'PY'
import re, sys
p = 'conf/wecross.toml'
s = open(p).read()
s = re.sub(r"server\s*=\s*'[^']*'", f"server = '{sys.argv[1]}:8340'", s)
s = re.sub(r"admin\s*=\s*'[^']*'", "admin = 'org1-admin'", s)
s = re.sub(r"password\s*=\s*'[^']*'", f"password = '{sys.argv[2]}'", s)
open(p, 'w').write(s)
PY
  # FISCO (BCOS3 stub): node0's SDK certs, the stub admin account is WeCross's own FISCO key.
  bash add_chain.sh -t BCOS3_ECDSA_EVM -n fisco -d conf/chains >/dev/null
  cp /fisco-sdk/ca.crt /fisco-sdk/sdk.crt /fisco-sdk/sdk.key conf/chains/fisco/
  sed -i "s/connectionsStr = .*/connectionsStr = ['${FISCO_CHANNEL:-10.88.1.10:20200}']/" conf/chains/fisco/stub.toml
  rm -f conf/chains/fisco/admin/*
  local keyfile="${WECROSS_FISCO_ADDRESS,,}_secp256k1.key"
  pem_of_hex "$WECROSS_FISCO_KEY" > "conf/chains/fisco/admin/${keyfile}"
  printf "[account]\n    type='BCOS3_ECDSA_EVM'\n    accountFile='%s'\n    password=''\n" "$keyfile" > conf/chains/fisco/admin/account.toml
  # Account manager: same CA as the router, MySQL user "wecross", PKCS#1 RSA key (V4: PKCS#8 crashes it).
  cp -r /opt/WeCross-Account-Manager "$AM"
  cp conf/ca.crt conf/ssl.crt conf/ssl.key "$AM/conf/"
  openssl genrsa -traditional -out "$AM/conf/rsa_private.pem" 2048 2>/dev/null
  openssl rsa -in "$AM/conf/rsa_private.pem" -pubout -out "$AM/conf/rsa_public.pem" 2>/dev/null
  python3 - "$AM/conf" "$WECROSS_ADMIN_PASSWORD" "$MYSQL_PASSWORD_WECROSS" "$WECROSS_AM_ENCRYPT_KEY" <<'PY'
import re, sys
d, admin, db, enc = sys.argv[1:]
s = open(f'{d}/application-sample.toml').read()
s = re.sub(r"(\[admin\][^\[]*?password\s*=\s*)'[^']*'", lambda m: f"{m.group(1)}'{admin}'", s, flags=re.S)
s = re.sub(r"(\[admin\][^\[]*?username\s*=\s*)'[^']*'", lambda m: f"{m.group(1)}'org1-admin'", s, flags=re.S)
s = re.sub(r"url\s*=\s*'jdbc:[^']*'", "url = 'jdbc:mysql://mysql:3306/wecross?useSSL=false&allowPublicKeyRetrieval=true'", s)
s = re.sub(r"(\[db\][^\[]*?username\s*=\s*)'[^']*'", lambda m: f"{m.group(1)}'wecross'", s, flags=re.S)
s = re.sub(r"(\[db\][^\[]*?password\s*=\s*)'[^']*'", lambda m: f"{m.group(1)}'{db}'", s, flags=re.S)
s = re.sub(r"encryptKey\s*=\s*'[^']*'", f"encryptKey = '{enc}'", s)
s = re.sub(r"allowImageAuthCodeEmpty\s*=\s*\w+", "allowImageAuthCodeEmpty = true", s)
open(f'{d}/application.toml', 'w').write(s)
PY
  chmod -R go-rwx /data
  touch /data/.ready
  echo "wecross: configuration generated"
  base_chain
  deploy_system
}

# Base (Praetor's EVM stub): rewritten on every setup run, since a reset fork has new addresses.
base_chain() {
  cd "$R"
  # The stub jar comes from the image: a rebuilt image brings its new version.
  cp /opt/WeCross/plugin/praetor-evm-stub-*.jar plugin/
  # RPC on the container's interface (the Docker network only, never published), not its loopback.
  python3 - <<'PY'
import re
p = 'conf/wecross.toml'
s = open(p).read()
s = re.sub(r"(\[rpc\][^\[]*?address\s*=\s*)'[^']*'", lambda m: m.group(1) + "'0.0.0.0'", s, flags=re.S)
open(p, 'w').write(s)
PY
  # The proxy routes "inbox" to WeCrossInbox.
  mkdir -p conf/chains/base
  python3 - "${DEPLOYMENTS_FILE:?}" "${BASE_RPC_URL:?}" > conf/chains/base/stub.toml <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"""[common]
    name = 'base'
    type = 'EVM'

[chain]
    rpcUrl = '{sys.argv[2]}'
    chainId = {d['chainId']}
    genesisBlock = {d['deployBlock']}

[proxy]
    address = '{d['wecrossProxy']}'

[[resources]]
    name = 'inbox'
    address = '{d['wecrossInbox']}'""")
PY
}

# WeCrossProxy and WeCrossHub on FISCO, once (the FISCO chain outlives consortium redeployments).
deploy_system() {
  [ -f /data/.system ] && return
  cd "$R"
  bash deploy_system_contract.sh -t BCOS3_ECDSA_EVM -c chains/fisco -P
  bash deploy_system_contract.sh -t BCOS3_ECDSA_EVM -c chains/fisco -H
  touch /data/.system
}

run_java_dir() { # start.sh daemonises java: run it, then follow its log in the foreground
  cd "$1"
  bash start.sh
  exec tail -F start.out
}

case "${1:-}" in
  setup) setup ;;
  account-manager) run_java_dir "$AM" ;;
  router) run_java_dir "$R" ;;
  *) echo "usage: entrypoint.sh setup|account-manager|router" >&2; exit 2 ;;
esac
