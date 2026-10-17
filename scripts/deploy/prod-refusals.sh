#!/bin/bash
# M18 gate (spec 10, I13): with PRAETOR_ENV=prod each service refuses the test-only settings of the local stack and
# exits instead of starting. Runs each service once, without its dependencies, through the production compose files.
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f infra/compose.yml -f infra/compose.prod.yml --env-file infra/.env.example)
[ -f .env ] && COMPOSE+=(--env-file .env)
[ -f .run/compose.env ] && COMPOSE+=(--env-file .run/compose.env)
fail=0
check() { # service, expected refusal text, extra -e settings...
  local svc="$1" want="$2"; shift 2
  local args=() name="praetor-refusal-$svc"
  for kv in "$@"; do args+=(-e "$kv"); done
  set +e
  out="$(timeout 120 "${COMPOSE[@]}" --profile core --profile chain --profile agent --profile tee-sim run --rm --no-deps --name "$name" -e PRAETOR_ENV=prod "${args[@]}" "$svc" 2>&1)"
  code=$?
  set -e
  docker rm -f "$name" >/dev/null 2>&1 || true
  if [ "$code" -ne 0 ] && grep -q "$want" <<<"$out"; then echo "ok   $svc refuses: $want"; else echo "FAIL $svc did not refuse ($want), exit $code"; fail=1; fi
}
check bank 'prod refuses simulator attestations' ATTESTATION_MODE=simulator
check agent-signer 'prod refuses simulator attestations' ATTESTATION_MODE=simulator
check soter-attester 'prod refuses' ATTESTATION_MODE=simulator SOTER_FAKE_TENCENT=1
check agent-runner 'prod refuses the fake LLM' FAKE_LLM_URL=http://fake-llm:3400
check api 'prod refuses the fake Tencent' SOTER_FAKE_TENCENT=1
exit "$fail"
