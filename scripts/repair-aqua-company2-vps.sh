#!/usr/bin/env bash
# Company-2 aquaculture history repairs (null-cycle, species mistags, IPT double BIO).
#
# Run ON the VPS after deploy (migrate is already in deploy-vps.sh):
#   cd ~/fserp/fserp && bash scripts/repair-aqua-company2-vps.sh
#   cd ~/fserp/fserp && bash scripts/repair-aqua-company2-vps.sh --apply
#
# Optional:
#   COMPANY_ID=2 bash scripts/repair-aqua-company2-vps.sh --apply
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
COMPANY_ID="${COMPANY_ID:-2}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

cd "$BACKEND"
export FSERP_USE_SQLITE=0
# Prefer repo venv, then backend venv (both layouts exist on some hosts).
if [[ -f "${REPO_ROOT}/venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/venv/bin/activate"
elif [[ -f "${BACKEND}/venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "${BACKEND}/venv/bin/activate"
fi

echo "==> Company ${COMPANY_ID}: null-cycle / species / IPT-BIO repairs"
echo "    mode: $([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN)"
echo

echo "---- 1/3 null-cycle sales ----"
python manage.py repair_aquaculture_null_cycle_sales --company-id "$COMPANY_ID" --dry-run
if [[ $APPLY -eq 1 ]]; then
  python manage.py repair_aquaculture_null_cycle_sales --company-id "$COMPANY_ID"
fi
echo

echo "---- 2/3 species mistags ----"
python manage.py repair_aquaculture_species_mistags --company-id "$COMPANY_ID" --dry-run
if [[ $APPLY -eq 1 ]]; then
  python manage.py repair_aquaculture_species_mistags --company-id "$COMPANY_ID"
fi
echo

echo "---- 3/3 IPT double BIO journals ----"
python manage.py repair_aquaculture_ipt_double_bio --company-id "$COMPANY_ID" --dry-run
if [[ $APPLY -eq 1 ]]; then
  python manage.py repair_aquaculture_ipt_double_bio --company-id "$COMPANY_ID"
fi
echo

if [[ $APPLY -eq 0 ]]; then
  echo "Dry-run only. Re-run with --apply when the summaries look right:"
  echo "  bash scripts/repair-aqua-company2-vps.sh --apply"
else
  echo "Apply complete. Remaining ambiguous rows stay null/manual (by design)."
fi
