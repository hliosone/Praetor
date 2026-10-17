#!/bin/bash
# Generates the 4-node FISCO BCOS Air chain for compose (spec 04): one container per node on fixed IPs of the
# praetor network, governance (auth) mode with the bank's FISCO account of the active key set as admin, web3 RPC on.
# Non-SM is the main profile; SM=1 builds the Guomi profile into nodes-sm. Refuses to overwrite an existing chain.
set -euo pipefail
cd "$(dirname "$0")"
out="${OUT:-nodes}"
if [ -e "$out" ]; then echo "fisco: $out exists, keeping the chain"; exit 0; fi
bash fetch.sh
set_prefix=LOCAL
[ "$(grep -hE '^CHAIN_MODE=' ../.env.example ../../.env 2>/dev/null | tail -1 | cut -d= -f2-)" = live ] && set_prefix=LIVE
admin_key="$(grep -E "^${set_prefix}_BANK_FISCO_KEY=" ../../.env | cut -d= -f2-)"
admin="$(cast wallet address --private-key "$admin_key")"
sm_flag=()
[ "${SM:-0}" = 1 ] && sm_flag=(-s)
bash downloads/build_chain.sh -l "10.88.1.10:1,10.88.1.11:1,10.88.1.12:1,10.88.1.13:1" -e downloads/fisco-bcos -a "$admin" -o "$out" "${sm_flag[@]}" >/dev/null
for ini in "$out"/*/node0/config.ini; do
  python3 -I - "$ini" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
blk = re.search(r"\[web3_rpc\][^\[]*", s).group(0)
new = re.sub(r"enable\s*=\s*\w+", "enable=true", blk)
new = re.sub(r"listen_ip\s*=\s*[\d.]+", "listen_ip=0.0.0.0", new)
new = re.sub(r"listen_port\s*=\s*\d+", "listen_port=8545", new)
open(p, "w").write(s.replace(blk, new))
PY
done
echo "fisco: generated $out (admin $admin, SM=${SM:-0})"
