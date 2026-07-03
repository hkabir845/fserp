#!/usr/bin/env bash
# Export live PostgreSQL from the VPS (run ON the server).
# Usage (on VPS): bash scripts/vps-export-live-db.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
ENV_FILE="${BACKEND}/.env"
OUT_DIR="${BACKEND}/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="${OUT_DIR}/fserp_live_${STAMP}.dump"
LATEST_LINK="${OUT_DIR}/fserp_live_latest.dump"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE" >&2
  exit 1
fi

db_url="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -z "$db_url" || "$db_url" == postgres://USER:* ]]; then
  echo "ERROR: Set DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "==> Dumping live PostgreSQL -> $OUT_FILE"
pg_dump "$db_url" -Fc --no-owner --no-acl -f "$OUT_FILE"

ln -sfn "$(basename "$OUT_FILE")" "$LATEST_LINK"

bytes="$(stat -c%s "$OUT_FILE" 2>/dev/null || wc -c < "$OUT_FILE")"
echo "Done: $OUT_FILE ($bytes bytes)"
echo "Latest symlink: $LATEST_LINK"
echo ""
echo "Download to your PC (run on Windows, adjust user/host if needed):"
echo "  scp sas@mahasoftcorporation.com:${OUT_FILE} I:/ITProjects/FSERP/backend/backups/"
echo "Then restore locally:"
echo "  powershell -File scripts/pull-vps-db-to-local.ps1 -DumpFile backend/backups/$(basename "$OUT_FILE")"
