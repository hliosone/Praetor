#!/bin/bash
# Secret scan (I10): the whole git history, then the uncommitted changes. Pinned image (Q5).
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE=zricethezav/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854
run() { docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/repo -w /repo "$IMAGE" "$@" --no-banner --redact --log-level warn; }
run git .
run git --pre-commit --staged .
run git --pre-commit .
echo "gitleaks: no leaks"
