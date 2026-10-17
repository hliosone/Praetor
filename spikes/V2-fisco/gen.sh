#!/usr/bin/env bash
# Generates a 4-node FISCO BCOS 3.17.1 Air chain for Docker: one container per node on fixed IPs of a
# private network, auth (governance) mode with the bank's FISCO account as admin, web3 RPC enabled.
# Usage: ADMIN=0x... [SM=1] [OUT=nodes] spikes/V2-fisco/gen.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
: "${ADMIN:?ADMIN (governance admin address) required}"
out="${OUT:-nodes}"
subnet_prefix="${SUBNET_PREFIX:-10.88.20}"
[[ -e "$out" ]] && { echo "$out exists; refusing to overwrite a chain"; exit 1; }
ips="${subnet_prefix}.10:1,${subnet_prefix}.11:1,${subnet_prefix}.12:1,${subnet_prefix}.13:1"
sm_flag=()
[[ "${SM:-0}" == "1" ]] && sm_flag=(-s)
bash downloads/build_chain.sh -l "$ips" -e downloads/fisco-bcos -a "$ADMIN" -o "$out" "${sm_flag[@]}"
# web3 RPC is generated disabled; open it on the container's interface (the network stays private).
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
echo "generated $out for $ips (admin $ADMIN, SM=${SM:-0})"
