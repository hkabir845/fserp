#!/usr/bin/env bash
# Balance Mynuddin Nursing pond P07 fingerling transfer P&L on VPS.
# Run ON the server (paste into your open SSH session):
#   bash scripts/reconcile-mynuddin-p07-vps.sh
#   bash scripts/reconcile-mynuddin-p07-vps.sh --apply
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${REPO_ROOT}/backend"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

cd "$BACKEND"
source "${REPO_ROOT}/venv/bin/activate"

python <<PY
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from django.db import transaction
from django.db.models import Sum

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond, Company
from api.services.aquaculture_data_bank_service import fiscal_period_for_end_date
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

APPLY = ${APPLY} == 1

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

company = (
    Company.objects.filter(custom_domain="mahasoftcorporation.com", is_deleted=False).first()
    or Company.objects.filter(is_deleted=False, aquaculture_enabled=True).order_by("id").first()
)
if not company:
    raise SystemExit("No company found")
cid = company.id

pond = AquaculturePond.objects.filter(company_id=cid, code__iexact="P07").first()
if not pond:
    pond = AquaculturePond.objects.filter(
        company_id=cid, name__icontains="Mynuddin", pond_role="nursing"
    ).first()
if not pond:
    raise SystemExit("P07 / Mynuddin nursing pond not found")

period_start, period_end = fiscal_period_for_end_date(company, date.today())
print(f"Company {cid} pond {pond.id} {pond.name!r} code={pond.code!r}")
print(f"Period {period_start} .. {period_end} apply={APPLY}")

def pl_row():
    payload = compute_aquaculture_pl_summary_dict(cid, period_start, period_end, pond.id, None, None, False)
    for row in payload.get("ponds") or []:
        if row.get("pond_id") == pond.id:
            return row
    return {}

row = pl_row()
income = money(row.get("income_total") or 0)
expense = money(row.get("expense_total") or 0)
gap = money(expense - income)
print(f"Before: income={income} expense={expense} net={money(income-expense)} gap={gap}")

if gap <= Decimal("0.01"):
    print("Already balanced.")
    raise SystemExit(0)

with transaction.atomic():
    n = resync_nursing_pond_transfer_costs(
        company_id=cid, from_pond_id=pond.id, from_production_cycle_id=None, sync_gl=False
    )
    print(f"Resync updated {n} line(s)")
    row = pl_row()
    income = money(row.get("income_total") or 0)
    expense = money(row.get("expense_total") or 0)
    gap = money(expense - income)
    print(f"After resync: income={income} expense={expense} net={money(income-expense)} gap={gap}")

    if gap <= Decimal("0.01"):
        if APPLY:
            for tr in AquacultureFishPondTransfer.objects.filter(company_id=cid, from_pond_id=pond.id):
                sync_aquaculture_fish_pond_transfer_gl(cid, tr)
        print("Balanced after resync.")
        if not APPLY:
            transaction.set_rollback(True)
        raise SystemExit(0)

    lines = list(
        AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=cid, transfer__from_pond_id=pond.id
        ).select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id")
    )
    active = [ln for ln in lines if int(ln.fish_count or 0) > 0]
    total_fish = sum(int(ln.fish_count or 0) for ln in active)
    if total_fish <= 0:
        raise SystemExit("No fingerling transfer lines to adjust")

    print(f"Distributing gap {gap} across {len(active)} line(s) by fish count:")
    running = Decimal("0")
    for i, ln in enumerate(active):
        fc = int(ln.fish_count or 0)
        if i == len(active) - 1:
            bump = money(gap - running)
        else:
            bump = money(gap * Decimal(fc) / Decimal(total_fish))
            running += bump
        old = money(ln.cost_amount or 0)
        new = money(old + bump)
        dest = ln.to_pond.code or ln.to_pond.name
        print(f"  line {ln.id} -> {dest} fish={fc}: {old} -> {new} (+{bump})")
        if APPLY:
            ln.cost_amount = new
            ln.save(update_fields=["cost_amount"])

    if APPLY:
        for tr in AquacultureFishPondTransfer.objects.filter(company_id=cid, from_pond_id=pond.id):
            r = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
            print(f"  GL xfer #{tr.id}: posted={r.get('posted')} amount={r.get('total_gl_amount')}")

    row = pl_row()
    income = money(row.get("income_total") or 0)
    expense = money(row.get("expense_total") or 0)
    net = money(income - expense)
    if not APPLY:
        income = money(income + gap)
        net = Decimal("0.00")
        transaction.set_rollback(True)
        print("DRY RUN — no changes saved")
    print(f"After: income={income} expense={expense} net={net}")
PY
