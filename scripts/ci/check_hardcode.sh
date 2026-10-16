#!/bin/sh
# Fail if application code hard-codes physical index names or model ids.
#
# Physical indexes (products_a1_1500_v1, ...) and model ids belong in configs/*.yaml;
# the app reads only the stable aliases and the configured embedders/LLMs.
# Scope: the clean-architecture layers that must stay config-driven. Missing
# directories are skipped so the check works while the refactor is in progress.
# Tests and YAML configs are never scanned.
#
# Usage: scripts/ci/check_hardcode.sh [repo_root]
set -eu

ROOT=${1:-$(cd "$(dirname "$0")/../.." && pwd)}

DIRS="api/shopmind/application api/shopmind/interfaces api/shopmind/domain"

# Physical index prefixes and model ids (ERE).
PATTERN='products_a1_|reviews_a3_|policies_a3_|google/siglip2|gpt-|bge-|(^|[^A-Za-z0-9_])e5-'

scan=""
for dir in $DIRS; do
    if [ -d "$ROOT/$dir" ]; then
        scan="$scan $ROOT/$dir"
    else
        echo "check_hardcode: $dir not found, skipping"
    fi
done

if [ -z "$scan" ]; then
    echo "check_hardcode: nothing to scan"
    exit 0
fi

# shellcheck disable=SC2086  # $scan is a space-separated list of directories without spaces
matches=$(grep -rnE --include='*.py' \
    --exclude-dir=tests --exclude-dir=__pycache__ \
    "$PATTERN" $scan || true)

if [ -n "$matches" ]; then
    echo "check_hardcode: hard-coded physical index names or model ids found:" >&2
    echo "$matches" >&2
    echo "Move them to configs/*.yaml and read them through the settings/registry." >&2
    exit 1
fi

echo "check_hardcode: OK"
