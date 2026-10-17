#!/bin/bash
# The anvil fork keeps no state across restarts: deploy the contracts again when the recorded hook has no code,
# then the FISCO consortium bound to that new hook.
set -euo pipefail
cd "$(dirname "$0")/../.."
mode="$(grep -hE '^CHAIN_MODE=' infra/.env.example .env 2>/dev/null | tail -1 | cut -d= -f2-)"
[ "$mode" = fork ] || exit 0
bash scripts/dev/fund-fork.sh
hook="$(python3 -c 'import json;print(json.load(open("infra/deployments/fork.json")).get("mandateHook",""))' 2>/dev/null || true)"
if [ -n "$hook" ] && [ "$(cast code "$hook" --rpc-url "${ANVIL_URL:-http://127.0.0.1:18545}")" != "0x" ]; then
  echo "fork deployment present ($hook)"
  exit 0
fi
bash scripts/deploy/contracts.sh fork
# The FISCO boards sign under the Base hook's domain: a new hook means a new consortium deployment (local only).
pnpm -s exec tsx scripts/fisco/deploy.ts local
# Services read the deployment files at startup: make up restarts them when this marker exists.
touch .run/deployments-changed
