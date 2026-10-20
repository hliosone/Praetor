#!/usr/bin/env bash
# Rebuilds the four submission PDFs in docs/submission/ from their Markdown sources: pandoc turns GitHub Markdown into
# HTML, then Playwright's Chromium (the web app's @playwright/test) prints A4 with page numbers, IBM Plex
# (fontsource on jsdelivr) and the mermaid diagrams (render-pdfs.mjs). Needs pandoc, pdftotext and the network (fonts, mermaid).
# Sources are read as committed at HEAD, so the commit in each footer is the one the text comes from; SOURCE=worktree
# reads the working tree instead (the footer then says so). PLAYWRIGHT_FROM=<dir with node_modules> resolves Playwright
# from another checkout (a git worktree has no node_modules of its own).
# Fails on a missing image, an internal link without its target, a mermaid error or a U+2014 in a PDF.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
command -v pandoc >/dev/null || { echo "build-pdfs: pandoc is missing" >&2; exit 1; }
command -v pdftotext >/dev/null || { echo "build-pdfs: pdftotext (poppler-utils) is missing" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
SOURCE="${SOURCE:-head}" WORK="$work" node scripts/submission/render-pdfs.mjs

for f in docs/submission/README.pdf docs/submission/ARCHITECTURE.pdf docs/submission/SELF_ASSESSMENT.pdf docs/submission/EVIDENCE.pdf; do
  if pdftotext "$f" - | grep -qP '\x{2014}'; then
    echo "build-pdfs: U+2014 in $f" >&2
    exit 1
  fi
  echo "build-pdfs: $f, $(pdfinfo "$f" | awk '/^Pages:/ {print $2}') pages"
done
