#!/usr/bin/env bash
# Pond feed GL + feeding-advice audit (works on VPS without reconcile_aquaculture_pond_feed command).
# Usage: bash scripts/vps-audit-pond-feed-inline.sh [company_id]
set -euo pipefail
CID="${1:-1}"
cd "$(dirname "$0")/../backend"
# shellcheck disable=SC1091
source venv/bin/activate

echo "=== GL gap audit (consumption + shop issue) company $CID ==="
python manage.py audit_gl_posting_gaps --company-id "$CID" \
  --type aquaculture_pond_consumption \
  --type aquaculture_shop_issue

echo ""
echo "=== Consumption expenses vs AUTO-AQ-POND journals ==="
python manage.py shell -c "
from api.models import AquacultureExpense, JournalEntry, Company, AquacultureExpenseInventoryLine, AquacultureFeedingAdvice
from api.services.aquaculture_pond_stock_service import POND_WAREHOUSE_CONSUMPTION_CATEGORIES, pond_warehouse_stock_matrix

cid = $CID
c = Company.objects.filter(pk=cid).first()
print(f'Company {cid} ({c.name if c else \"?\"})')

missing = []
for exp in AquacultureExpense.objects.filter(company_id=cid, expense_category__in=POND_WAREHOUSE_CONSUMPTION_CATEGORIES, amount__gt=0).order_by('id'):
    en = f'AUTO-AQ-POND-{exp.id}-COGS'
    if not JournalEntry.objects.filter(company_id=cid, entry_number=en).exists():
        missing.append((exp.id, exp.expense_category, str(exp.amount), str(exp.expense_date), en))
print(f'Consumption expenses: {AquacultureExpense.objects.filter(company_id=cid, expense_category__in=POND_WAREHOUSE_CONSUMPTION_CATEGORIES, amount__gt=0).count()}, missing JE: {len(missing)}')
for row in missing:
    print('  MISSING', row)

shop_missing = []
for exp in AquacultureExpense.objects.filter(company_id=cid, source_station_id__isnull=False, amount__gt=0).order_by('id'):
    en = f'AUTO-AQ-SHOP-{exp.id}-COGS'
    if not JournalEntry.objects.filter(company_id=cid, entry_number=en).exists():
        shop_missing.append((exp.id, exp.expense_category, str(exp.amount), str(exp.expense_date), en))
print(f'Shop issues: {AquacultureExpense.objects.filter(company_id=cid, source_station_id__isnull=False, amount__gt=0).count()}, missing JE: {len(shop_missing)}')
for row in shop_missing:
    print('  MISSING SHOP', row)

def is_feed(row):
    cat = (row.get('pos_category') or '').lower()
    if cat == 'feed':
        return True
    return 'feed' in (row.get('item_name') or '').lower()

feed = [r for r in pond_warehouse_stock_matrix(cid) if is_feed(r)]
print(f'Pond warehouse feed on hand: {len(feed)} row(s)')
for r in feed:
    print(f\"  pond {r['pond_id']} {r['pond_name']!r} item {r['item_id']} {r['item_name']!r} qty={r['quantity']} {r['unit']} cost={r['unit_cost']}\")

manual = []
for adv in AquacultureFeedingAdvice.objects.filter(company_id=cid, status='applied', linked_expense_id__isnull=False).select_related('linked_expense', 'pond'):
    exp = adv.linked_expense
    if not exp:
        continue
    if (exp.expense_category or '') == 'feed_purchase' and not AquacultureExpenseInventoryLine.objects.filter(expense_id=exp.id).exists() and exp.source_station_id is None:
        has_gl = JournalEntry.objects.filter(company_id=cid, entry_number=f'AUTO-AQ-EXP-{exp.id}').exists()
        manual.append((adv.id, adv.pond_id, (adv.pond.name if adv.pond else ''), str(adv.applied_feed_kg), exp.id, str(exp.amount), has_gl))
print(f'Manual feed_purchase on applied advice (wrong path): {len(manual)}')
for row in manual:
    print(f'  advice #{row[0]} pond {row[1]} {row[2]!r} kg={row[3]} expense #{row[4]} amt={row[5]} gl={row[6]}')

no_exp = list(AquacultureFeedingAdvice.objects.filter(company_id=cid, status='applied', linked_expense_id__isnull=True, applied_feed_kg__gt=0).select_related('pond').order_by('target_date', 'id'))
print(f'Applied advice with kg but no expense: {len(no_exp)}')
for adv in no_exp:
    print(f'  advice #{adv.id} pond {adv.pond_id} {(adv.pond.name if adv.pond else \"\")!r} kg={adv.applied_feed_kg} date={adv.target_date}')
"
