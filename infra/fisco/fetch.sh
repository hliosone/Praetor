#!/bin/bash
# Downloads the FISCO BCOS 3.17.1 release binary and build_chain.sh into infra/fisco/downloads, checked by sha256
# (spec 04, V2: no 3.17.1 Docker image exists, so we build our own from the release binary).
# `fetch.sh console` also fetches the FISCO console 3.8.0 (Java SDK 3.8.0 and its jars, FISCO's SM solc), only
# for the Guomi smoke (make smoke-sm): 258 MB the stack itself never needs.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p downloads
REL=https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/v3.17.1
fetch() {
  local name="$1" sum="$2" url="${3:-$REL/$1}"
  if [ ! -f "downloads/$name" ] || ! echo "$sum  downloads/$name" | sha256sum -c --quiet - 2>/dev/null; then
    curl -fsSL -o "downloads/$name.part" "$url"
    mv "downloads/$name.part" "downloads/$name"
  fi
  echo "$sum  downloads/$name" | sha256sum -c --quiet -
}
fetch fisco-bcos-linux-x86_64.tar.gz 28eb054bb222b805e116bf7d2462709f99d1f460a732e978555abe61973b3cbb
fetch build_chain.sh ed667e1e346acbe2fea7b667856ddf05af9e4892ac0424ff9f703f0ea601dbe7
[ -f downloads/fisco-bcos ] || tar -xzf downloads/fisco-bcos-linux-x86_64.tar.gz -C downloads
if [ "${1:-}" = console ]; then
  fetch console-3.8.0.tar.gz 255f1b67b22f0672612e41f93e816c2ba53a9dd3684ccc2a64c75e1b02fb6d1a \
    https://github.com/FISCO-BCOS/console/releases/download/v3.8.0/console.tar.gz
  [ -d downloads/console ] || tar -xzf downloads/console-3.8.0.tar.gz -C downloads
fi
echo "fisco downloads ok"
