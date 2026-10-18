#!/bin/bash
# In `make up` with the wecross profile, once the router is up and before the rest of the stack is waited for
# (bridge-relayer is unhealthy until the outbox has its hub): wire the outbox hub, the callback resource and the
# router's accounts (scripts/wecross/up.ts, idempotent), then restart the router when its accounts changed (it reads
# them at login).
set -euo pipefail
cd "$(dirname "$0")/../.."
# make up passes its compose command and profile flags (prod file, live env); by hand, the profiles the wecross
# services depend on (mysql is in core and chain: --profile wecross alone is an invalid project).
COMPOSE="${COMPOSE:-docker compose -f infra/compose.yml --env-file infra/.env.example --env-file .env --env-file .run/compose.env --profile core --profile chain --profile wecross}"
until curl -sf -m 3 http://10.88.0.30:8250/sys/test >/dev/null; do sleep 3; done
pnpm -s exec tsx scripts/wecross/up.ts
if [ -f .run/wecross-restart-router ]; then
  $COMPOSE restart wecross-router >/dev/null
  rm -f .run/wecross-restart-router
  until curl -sf -m 3 http://10.88.0.30:8250/sys/test >/dev/null; do sleep 3; done
  echo "wecross: router restarted with its accounts"
fi
