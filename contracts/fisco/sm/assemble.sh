#!/bin/bash
# Assembles the Guomi profile build of the FISCO contracts into contracts/fisco/sm/build (spec 04, M15): the main
# sources and PraetorTypes, plus opaque-board.patch (opaque signatures, no on-chain EIP-712). FISCO's SM solc is a
# 0.8.26 pre-release ("0.8.26-develop", which semver ranks below 0.8.26), so the exact `pragma solidity 0.8.28;`
# becomes `^0.8.25` in the copies: the one line changed per file besides the patch. The main sources are never
# modified. Used by make test (Foundry, profile sm) and by the SM smoke (compiled there with the SM solc).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fisco="$here/.."
out="$here/build"
rm -rf "$out"
mkdir -p "$out/src" "$out/protocol"
cp "$fisco"/src/*.sol "$out/src/"
cp "$fisco/../../packages/protocol/sol/PraetorTypes.sol" "$out/protocol/"
patch -s --fuzz=0 --no-backup-if-mismatch -d "$out/src" -p1 <"$here/opaque-board.patch"
for f in "$out"/src/*.sol "$out"/protocol/*.sol; do
  n="$(grep -c '^pragma solidity 0.8.28;$' "$f" || true)"
  [ "$n" = 1 ] || { echo "sm assemble: expected one 'pragma solidity 0.8.28;' in $f, found $n"; exit 1; }
  sed -i -e 's/^pragma solidity 0.8.28;$/pragma solidity ^0.8.25;/' "$f"
done
echo "sm assemble: $(ls "$out/src" | wc -l) contracts in ${out#"$PWD"/}"
