#!/usr/bin/env bash
# Fails if any tracked file outside vendored code contains U+2014 (em dash).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# Vendored or third-party trees keep their upstream text.
exclude='^(contracts/[^/]+/lib/|.*/vendor/|.*/node_modules/|pnpm-lock\.yaml$)'
hits="$(git ls-files -z | grep -zvE "$exclude" | xargs -0 -r grep -nIP '\x{2014}' -- 2>/dev/null || true)"
if [[ -n "$hits" ]]; then
  echo "no-emdash: U+2014 found (use a colon, a comma, parentheses or a new sentence):" >&2
  echo "$hits" >&2
  exit 1
fi
echo "no-emdash: ok"
