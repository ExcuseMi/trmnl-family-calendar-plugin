#!/usr/bin/env bash
# trmnlp lint, minus one warning that is wrong, and failing on everything else.
#
# THE ONE WARNING. `trmnlp lint` checks each custom field's `field_type`
# against a list vendored inside the gem, and that list predates `lat_lon`,
# the hosted service's Location picker: search a city, pick a match, or type
# coordinates. The field is real and live, this plugin's Location setting has
# used it since it stopped being a plain string, and the hosted service
# accepts it on every push. 0.12.0 is the newest release, so there is no
# upgrade that knows about it, and `FormField::DATA_PATH` is hardcoded to the
# gem's own file, so there is no project-local schema to point it at either.
#
# The alternative was editing the installed gem by hand. That works on one
# machine, is invisible to everybody else, and disappears on the next
# `gem install`, which is how a green lint here turns into a red one
# somewhere else. So the exception lives in the repository instead, where it
# can be read, and it is narrow: this drops that exact line and nothing else,
# and only while settings.yml really does ask for `lat_lon`.
#
# This is the sibling Metro plugin's plugin/lint.sh, with the paths moved: the
# trmnlp project root here is plugin/src (that is where .trmnlp.yml lives), so
# the settings file is plugin/src/src/settings.yml. The script sits outside
# plugin/src on purpose, because the TRMNL sync bot rewrites that directory.
#
# Usage: plugin/lint.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$HERE/src"

STALE='unknown field_type: lat_lon'

if ! grep -q 'field_type: lat_lon' "$PROJECT/src/settings.yml"; then
  # Nothing asks for it any more, so the exception should go with it.
  echo "plugin/lint.sh: settings.yml no longer uses lat_lon; delete the exception in this script." >&2
  exit 2
fi

out="$(cd "$PROJECT" && trmnlp lint 2>&1)"
status=$?

# Keep every line except the stale one and the "N issues found" header, which
# counts it. What is left is either nothing or a real finding.
rest="$(printf '%s\n' "$out" | grep -v "$STALE" | grep -vE '^[0-9]+ issues? found:' | grep -vE '^\s*$')"
# The numbered bullets carry their own "Learn more" line; drop those too when
# their bullet is gone.
real="$(printf '%s\n' "$rest" | grep -vE '^\s+Learn more:' | grep -vE '^\s+[0-9]+\. .*lat_lon')"

if printf '%s\n' "$out" | grep -q "$STALE"; then
  echo "plugin/lint.sh: ignoring the known-stale warning \"$STALE\" (see the note at the top of this script)."
fi

if [ -z "$(printf '%s' "$real" | tr -d '[:space:]')" ]; then
  echo "✓ trmnlp lint: clean (apart from the known-stale lat_lon warning)"
  exit 0
fi

echo "$real"
exit "${status:-1}"
