#!/bin/bash
# Static analysis of the Base and FISCO contracts (spec 03, 04, 08). Fails on any High or Medium finding outside the
# three detector classes explained finding by finding in docs/security/slither.md. Vendored third-party code
# (contracts/base/src/vendor, the WeCross proxy) is filtered like lib/ and triaged separately in that file.
set -euo pipefail
cd "$(dirname "$0")/../../contracts"
for tree in base fisco; do
  echo "slither: contracts/$tree"
  (cd "$tree" && slither . \
    --filter-paths "lib/|test/|script/|packages/protocol|src/vendor/" \
    --exclude-informational --exclude-optimization \
    --exclude uninitialized-local,unused-return,incorrect-equality \
    --fail-medium)
done
