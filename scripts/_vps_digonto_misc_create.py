"""Create Digonto P04 misc vendor bill (4384.45) on VPS to hit 765k net."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction

from api.models import AquaculturePond, Bill, BillLine, ChartOfAccount, Vendor
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.gl_posting import post_bill_journal

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

CID = 2
POND_ID = 15
AMOUNT = Decimal("4384.45")
BILL_NO = "BILL-MISC-CROP-2526"
BILL_DATE = date(2026, 2, 19)
MEMO = "Crop year misc pond costs — Digonto (Feb 2025–Feb 2026)"

pond = AquaculturePond.objects.get(pk=POND_ID)
start, end = date(2025, 2, 20), date(2026, 2, 20)

existing = Bill.objects.filter(company_id=CID, bill_number=BILL_NO).first()
if existing:
    print(f"SKIP bill already exists id={existing.id}")
    bill = existing
else:
    vendor = Vendor.objects.filter(company_id=CID, is_active=True).order_by("id").first()
    if not vendor:
        vendor = Vendor.objects.create(
            company_id=CID,
            company_name="Misc Pond Vendor",
            vendor_number="V-MISC-01",
            is_active=True,
        )
    exp_acc = ChartOfAccount.objects.filter(company_id=CID, account_code="6725").first()
    with transaction.atomic():
        bill = Bill.objects.create(
            company_id=CID,
            vendor=vendor,
            bill_number=BILL_NO,
            bill_date=BILL_DATE,
            due_date=BILL_DATE,
            status="paid",
            memo=MEMO,
            subtotal=AMOUNT,
            tax_total=Decimal("0"),
            total=AMOUNT,
        )
        BillLine.objects.create(
            bill=bill,
            description="Miscellaneous crop-year pond costs",
            quantity=Decimal("1"),
            unit_price=AMOUNT,
            amount=AMOUNT,
            aquaculture_pond_id=POND_ID,
            aquaculture_cost_bucket="miscellaneous",
            expense_account=exp_acc,
        )
    print(f"CREATED bill id={bill.id} vendor={vendor.company_name} amt={AMOUNT}")

ok = post_bill_journal(CID, bill)
print(f"post_bill_journal={ok}")

pl = compute_aquaculture_pl_summary_dict(CID, start, end, POND_ID, None, None, False)
row = next(x for x in pl["ponds"] if x["pond_id"] == POND_ID)
print(f"PL {start}..{end}: income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
for item in pl.get("expenses_by_category") or []:
    if item.get("amount") and Decimal(str(item["amount"])) > 0:
        if item["category"] in ("lease", "vendor_bill_pond", "shop_supplies", "day_labor"):
            print(f"  {item['category']}: {item['amount']}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
if err:
    print("STDERR:", err)
c.close()
