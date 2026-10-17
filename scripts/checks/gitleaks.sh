#!/bin/bash
# Secret scan (I10): the whole git history, staged and unstaged changes, and new untracked files
# (git modes skip untracked files, so those are copied to a scratch dir and scanned as a directory).
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE=zricethezav/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854
# The checkout and its git directory are mounted at their own paths: in a git worktree .git is a file pointing to the
# main repository's git directory, which a /repo mount alone would not reach (the scan would read no history).
common="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
run() { docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":"$PWD" -v "$common":"$common" -w "$PWD" "$IMAGE" "$@" --no-banner --redact --log-level warn --config "$PWD/.gitleaks.toml"; }
[ "$(git rev-list --count HEAD)" -gt 0 ] || { echo "gitleaks: no history to scan" >&2; exit 1; }
run git .
run git --pre-commit --staged .
run git --pre-commit .
scratch=".run/gitleaks-untracked"
rm -rf "$scratch"
mkdir -p "$scratch"
git ls-files -z --others --exclude-standard | while IFS= read -r -d '' f; do
  mkdir -p "$scratch/$(dirname "$f")"
  cp -P "$f" "$scratch/$f"
done
if [ -n "$(ls -A "$scratch")" ]; then
  (cd "$scratch" && docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/scan -v "$OLDPWD/.gitleaks.toml":/cfg.toml:ro -w /scan "$IMAGE" dir . --no-banner --redact --log-level warn --config /cfg.toml)
fi
rm -rf "$scratch"
echo "gitleaks: no leaks"
