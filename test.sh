#!/usr/bin/env bash
# Runs both regression suites locally: transform.js's own tests, and the config editor's
# (tools/config-editor.html) DOM-driven tests. No Docker/browser needed — just Node.
# Usage: ./test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT/test/transform"
node run.js

cd "$ROOT/test/config-editor"
npm install --no-audit --no-fund --silent
node run.js
