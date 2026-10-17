#!/usr/bin/env bash
# Clones the pinned Solidity libraries for this spike (kept out of git).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib
[[ -d lib/forge-std ]] || git clone -q https://github.com/foundry-rs/forge-std lib/forge-std
if [[ ! -d lib/webauthn-sol ]]; then
  git clone -q https://github.com/base/webauthn-sol lib/webauthn-sol
  git -C lib/webauthn-sol checkout -q 619f20ab0f074fef41066ee4ab24849a913263b2
  git -C lib/webauthn-sol submodule update -q --init --recursive
fi
