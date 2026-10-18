#!/bin/bash
# After `make up` with the wecross profile: wire the outbox hub, the callback resource and the router's accounts
# (scripts/wecross/up.ts, idempotent), then restart the router when its accounts changed (it reads them at login).
set -euo pipefail
cd "$(dirname "$0")/../.."
# make up passes its own compose command with every profile flag: with only --profile wecross, compose refuses the
# router's restart ("depends on undefined service mysql"). The default mirrors the Makefile's for a run by hand.
COMPOSE="${COMPOSE:-docker compose -f infra/compose.yml --env-file infra/.env.example --env-file .env --env-file .run/compose.env --profile core --profile chain --profile mocks --profile tee-sim --profile agent --profile dev --profile wecross}"
until curl -sf -m 3 http://10.88.0.30:8250/sys/test >/dev/null; do sleep 3; done
pnpm -s exec tsx scripts/wecross/up.ts
if [ -f .run/wecross-restart-router ]; then
  # shellcheck disable=SC2086 # COMPOSE is a command line, split on purpose
  $COMPOSE restart wecross-router >/dev/null
  rm -f .run/wecross-restart-router
  until curl -sf -m 3 http://10.88.0.30:8250/sys/test >/dev/null; do sleep 3; done
  echo "wecross: router restarted with its accounts"
fi
