#!/bin/bash
# anvil starts a fork at the pinned block's timestamp, so its clock lags the wall clock by the age of FORK_BLOCK.
# Live Base agrees with wall clocks, and the TEEs check expiries against theirs: move the fork forward (never back).
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="$(grep -hE '^CHAIN_MODE=' infra/.env.example .env 2>/dev/null | tail -1 | cut -d= -f2-)"
[ "$mode" = fork ] || exit 0
rpc="${ANVIL_URL:-http://127.0.0.1:18545}"
chain="$(cast block latest --rpc-url "$rpc" -f timestamp)"
wall="$(date +%s)"
if [ $((wall - chain)) -gt 30 ]; then
  cast rpc --rpc-url "$rpc" evm_setNextBlockTimestamp "$wall" >/dev/null
  cast rpc --rpc-url "$rpc" evm_mine >/dev/null
  echo "fork clock moved forward by $((wall - chain)) s"
fi
