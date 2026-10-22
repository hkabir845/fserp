#!/usr/bin/env bash
# Audit all dates; optionally apply the reviewed company-2 entity corrections.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLY=0
THROUGH="$(TZ=Asia/Dhaka date +%F)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --through) THROUGH="${2:?Provide YYYY-MM-DD after --through}"; shift 2 ;;
    *) echo "Usage: bash $0 [--apply] [--through YYYY-MM-DD]" >&2; exit 2 ;;
  esac
done
if [[ -x "$ROOT/backend/venv/bin/python" ]]; then
  PYTHON="$ROOT/backend/venv/bin/python"
elif [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
  PYTHON="$ROOT/backend/.venv/bin/python"
else
  echo "Backend Python environment not found (venv or .venv)." >&2; exit 1
fi
cd "$ROOT/backend"
LOG_DIR="$ROOT/backend/backups/entity-review-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"
"$PYTHON" manage.py audit_income_expense_entities --company-id 2 > "$LOG_DIR/before.json"
if [[ "$APPLY" == 1 ]]; then
  bash "$ROOT/scripts/vps-export-live-db.sh"
  "$PYTHON" manage.py repair_income_expense_entities \
    --company-id 2 --through "$THROUGH" \
    --head-office-bill-number BILL-843 \
    --head-office-bill-number BILL-876 \
    --head-office-bill-number BILL-882 \
    --donation-station-id 2 --apply > "$LOG_DIR/reviewed-bills.json"
  "$PYTHON" manage.py sync_bill_charge_to_entities \
    --company-id 2 --through "$THROUGH" --apply > "$LOG_DIR/sync.json"
  "$PYTHON" manage.py audit_income_expense_entities --company-id 2 > "$LOG_DIR/after.json"
else
  cp "$LOG_DIR/before.json" "$LOG_DIR/after.json"
fi
"$PYTHON" - "$LOG_DIR" <<'PY'
import json, pathlib, sys
folder = pathlib.Path(sys.argv[1])
for filename in ("before.json", "after.json"):
    data = json.loads((folder / filename).read_text())["companies"][0]
    print(filename, json.dumps({
        "posted_journals": data.get("posted_journal_count"),
        "issues": data.get("issue_counts", {}),
        "opening_journals_to_review": [r for r in data.get("issues", []) if r["type"] in (
            "orphaned_pond_opening_journal", "pond_opening_entity_mismatch")],
        "failed_report_checks": [r for r in data.get("report_checks", []) if not r["passed"]],
        "head_office_bills_to_review": [r for r in data.get("head_office_description_checks", []) if r["needs_review"]],
        "suspect_dates": data.get("suspect_dates", []),
    }, indent=2))
print("Detailed logs:", folder)
PY
