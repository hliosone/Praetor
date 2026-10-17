#!/bin/bash
# Static analysis of the Base contracts (spec 03, 08). Fails on any High or Medium finding outside the three
# detector classes explained finding by finding in docs/security/slither.md.
set -euo pipefail
cd "$(dirname "$0")/../../contracts/base"
slither . \
  --filter-paths "lib/|test/|script/|packages/protocol" \
  --exclude-informational --exclude-optimization \
  --exclude uninitialized-local,unused-return,incorrect-equality \
  --fail-medium
