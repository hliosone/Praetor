#!/bin/bash
# Writes .run/compose.env: the active key set (LOCAL_ on the fork, LIVE_ on Base Sepolia, D1) under the unprefixed
# names that compose interpolates, the same names the prod server's .env uses. Values are never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .run
# CHAIN_MODE from the environment first (make up LIVE=1 exports it), then .env, then the example.
mode="${CHAIN_MODE:-$(grep -E '^CHAIN_MODE=' .env 2>/dev/null | cut -d= -f2- || true)}"
mode="${mode:-$(grep -E '^CHAIN_MODE=' infra/.env.example | cut -d= -f2-)}"
set_prefix=LOCAL
[ "$mode" = live ] && set_prefix=LIVE
umask 077
: > .run/compose.env
# FISCO-side keys from FISCO_KEYSET when set (D75: one local FISCO chain, governed by the LOCAL set, for every mode).
fisco_roles='(BANK|REGULATOR|OPERATOR|RELAYER|WECROSS)_FISCO_KEY|WEID_ADMIN_KEY'
fset="${FISCO_KEYSET:-$set_prefix}"
grep -E "^${set_prefix}_[A-Z0-9_]+=" .env | sed -E "s/^${set_prefix}_//" | grep -vE "^(${fisco_roles})=" >> .run/compose.env
grep -E "^${fset}_(${fisco_roles})=" .env | sed -E "s/^${fset}_//" >> .run/compose.env
echo "CADDYFILE_SHA=$(sha256sum infra/Caddyfile | cut -c1-16)" >> .run/compose.env
echo "compose.env: ${set_prefix} key set for CHAIN_MODE=${mode}, FISCO keys from ${fset}"
