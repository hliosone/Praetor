#!/usr/bin/env bash
# V8 probe: latest XAU/USD and XAG/USD from Pyth Hermes, normalised to 8 decimals (spec 02 units).
# Reads PYTH_API_KEY from the environment (never printed). Usage: PYTH_API_KEY=... spikes/V8-pyth/probe.sh [base-url]
set -euo pipefail
base="${1:-${PYTH_HERMES_URL:-https://pyth.dourolabs.app/hermes}}"
ids='ids[]=0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2&ids[]=0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e'
auth=()
[[ -n "${PYTH_API_KEY:-}" ]] && auth=(-H "Authorization: Bearer ${PYTH_API_KEY}")
body="$(curl -s -m 20 -w '\n%{http_code}' "${auth[@]}" "$base/v2/updates/price/latest?$ids&parsed=true")"
status="${body##*$'\n'}"; body="${body%$'\n'*}"
echo "status=$status"
[[ "$status" == 200 ]] || { echo "body=$body"; exit 1; }
python3 -I -c '
import json, sys
names = {"765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2": "XAU/USD",
         "f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e": "XAG/USD"}
for p in json.loads(sys.argv[1])["parsed"]:
    price, expo, t = int(p["price"]["price"]), int(p["price"]["expo"]), int(p["price"]["publish_time"])
    # price8 = price * 10^(expo + 8); truncates when expo < -8
    price8 = price * 10 ** (expo + 8) if expo >= -8 else price // 10 ** (-8 - expo)
    print(f"{names[p[\"id\"]]}: price={price} expo={expo} publish_time={t} price8={price8}")
' "$body"
