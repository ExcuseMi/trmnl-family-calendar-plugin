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
# plugin/lint.sh rather than bare `trmnlp lint`: the gem's field_type list predates lat_lon, so
# bare lint can never go green while the plugin has a Location field, and a check that always
# fails is one everybody learns to ignore. The wrapper drops that single warning, fails on
# everything else, and tells you to delete itself if settings.yml stops using the field.
if command -v trmnlp >/dev/null 2>&1; then
  "$ROOT/plugin/lint.sh"
else
  echo "SKIP: trmnlp is not on PATH, so its lint did not run"
fi
