#!/usr/bin/env bash
# Runs every suite, cheapest first, then trmnlp's own lint:
#   test/transform      transform.js's output           plain Node, milliseconds
#   test/config-editor  tools/config-editor.html        Node + jsdom
#   test/layout         the RENDERED board's geometry   trmnlp build + headless Chromium,
#                                                       skips itself without either
# Usage: ./test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT/test/transform"
node run.js

cd "$ROOT/test/config-editor"
npm install --no-audit --no-fund --silent
node run.js

cd "$ROOT/test/layout"
node run.js

# The inline-style budget is easy to blow by accident, because the check scans the raw file for
# CSS property names — a name written in a comment or in the template's own script costs a slot
# just like a real style does. Running it here is what stops that creeping back.
#
# One known false positive is filtered out: trmnlp 0.12.0 does not recognise the lat_lon field
# type, which TRMNL's own server does (settings.yml is synced from it, and the field drives
# sunrise/sunset and weather on the device). Every other issue fails this script.
if command -v trmnlp >/dev/null 2>&1; then
  cd "$ROOT/plugin/src"
  echo "trmnlp lint"
  lint_out=$(trmnlp lint 2>&1 || true)
  echo "$lint_out"
  real_issues=$(printf '%s\n' "$lint_out" | grep -E '^[[:space:]]+[0-9]+\.' | grep -v 'unknown field_type: lat_lon' || true)
  if [ -n "$real_issues" ]; then
    echo
    echo "lint issues that are not the known trmnlp field_type gap:"
    echo "$real_issues"
    exit 1
  fi
else
  echo "SKIP: trmnlp is not on PATH, so its lint did not run"
fi
