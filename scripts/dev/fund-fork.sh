#!/bin/bash
# The fork has no faucet: give 10 ETH to every key of the LOCAL set that sends Base transactions (deployer,
# bundler, desk operator, oracle feeder, payout partner, treasury, WeCross Base account). Idempotent.
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC="${ANVIL_URL:-http://127.0.0.1:18545}"
for role in DEPLOYER_KEY BUNDLER_KEY DESK_OPERATOR_KEY ORACLE_FEEDER_KEY PAYOUT_PARTNER_KEY TREASURY_KEY WECROSS_BASE_KEY; do
  k="$(grep -E "^LOCAL_${role}=" .env | head -1 | cut -d= -f2-)"
  [ -n "$k" ] && cast rpc --rpc-url "$RPC" anvil_setBalance "$(cast wallet address --private-key "$k")" 0x8AC7230489E80000 >/dev/null
done
echo "fork keys funded"
