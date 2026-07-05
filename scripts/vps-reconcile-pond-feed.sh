#!/usr/bin/env bash
# Audit and fix pond feed GL + return unused pond-warehouse feed to shop (run on VPS from repo root).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/backend"
# shellcheck disable=SC1091
source venv/bin/activate

COMPANY_ID="${1:-1}"
FIX="${FIX:-0}"
RETURN_FEED="${RETURN_FEED:-0}"

ARGS=(--company-id "$COMPANY_ID")
if [[ "$FIX" == "1" ]]; then
  ARGS+=(--fix-gl)
fi
if [[ "$RETURN_FEED" == "1" ]]; then
  ARGS+=(--return-feed)
fi

echo "==> reconcile_aquaculture_pond_feed ${ARGS[*]}"
python manage.py reconcile_aquaculture_pond_feed "${ARGS[@]}"
