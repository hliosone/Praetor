#!/usr/bin/env bash
# Tests the commit-msg hook: message files directly, then one real commit in a throwaway repo.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
hook="$here/commit-msg"
mkdir -p "$repo/.run"
work="$(mktemp -d "$repo/.run/hooktest.XXXXXX")"
trap 'rm -rf "$work"' EXIT
fail=0

expect() { # expect <pass|reject> <message>
  printf '%s\n' "$2" >"$work/msg"
  if bash "$hook" "$work/msg" 2>/dev/null; then got=pass; else got=reject; fi
  if [[ "$got" == "$1" ]]; then echo "ok   $1: ${2%%$'\n'*}"; else echo "FAIL expected $1, got $got: $2"; fail=1; fi
}

expect pass   "docs: add CLAUDE.md run mode"
expect pass   "chore: turn off assistant attribution in .claude/settings.json"
expect pass   "feat(hook): refuse OVER_HARD_CAP before user budgets"
expect pass   $'feat(x): y\n\n# Co-Authored-By: in a comment line is stripped by git'
expect reject $'feat(x): y\n\nCo-Authored-By: Someone <a@b.c>'
expect reject $'feat(x): y\n\nco-authored-by: someone <a@b.c>'
expect reject $'feat(x): y\n\nGenerated with Claude Code'
expect reject "fix: thanks Claude"

# A real commit in a throwaway repository with the hook installed through core.hooksPath.
git -C "$work" init -q tmprepo
git -C "$work/tmprepo" config user.email test@example.invalid
git -C "$work/tmprepo" config user.name test
git -C "$work/tmprepo" config core.hooksPath "$here"
echo a >"$work/tmprepo/a"
git -C "$work/tmprepo" add a
if git -C "$work/tmprepo" commit -q -m "feat: a" -m "Co-Authored-By: Someone <a@b.c>" 2>/dev/null; then
  echo "FAIL real commit with a Co-Authored-By trailer was accepted"; fail=1
else
  echo "ok   real commit with a Co-Authored-By trailer rejected"
fi
if git -C "$work/tmprepo" commit -q -m "feat: a" 2>/dev/null; then
  echo "ok   real clean commit accepted"
else
  echo "FAIL real clean commit rejected"; fail=1
fi
exit $fail
