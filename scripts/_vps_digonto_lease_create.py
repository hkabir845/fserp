"""Create missing Digonto P04 lease payment (18500) on VPS."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.db.models import F

from api.models import AquacultureLandlordLedgerEntry, AquaculturePond
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.gl_posting import sync_landlord_lease_payment_journal

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

AMOUNT = Decimal("18500.00")
ENTRY_DATE = date(2026, 2, 18)
LANDLORD_ID = 27
POND_ID = 15
BANK_ACCOUNT_ID = 5
MEMO = "Crop year lease balance — Digonto (Feb 2025–Feb 2026)"
REFERENCE = "LEASE-CROP-2526"

pond = AquaculturePond.objects.get(pk=POND_ID)
start, end = date(2025, 2, 20), date(2026, 2, 20)

existing = AquacultureLandlordLedgerEntry.objects.filter(
    landlord_id=LANDLORD_ID,
    pond_id=POND_ID,
    kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
    reference=REFERENCE,
).first()
if existing:
    print(f"SKIP already exists id={existing.id} amt={money(abs(existing.amount_signed))}")
else:
    with transaction.atomic():
        ent = AquacultureLandlordLedgerEntry.objects.create(
            landlord_id=LANDLORD_ID,
            pond_id=POND_ID,
            entry_date=ENTRY_DATE,
            kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
            amount_signed=-AMOUNT,
            memo=MEMO,
            reference=REFERENCE,
            applies_to_lease_paid=True,
            lease_paid_delta=AMOUNT,
            bank_account_id=BANK_ACCOUNT_ID,
            payment_method="cash",
        )
        AquaculturePond.objects.filter(pk=POND_ID).update(
            lease_paid_to_landlord=F("lease_paid_to_landlord") + AMOUNT
        )
        je, gerr = sync_landlord_lease_payment_journal(pond.company_id, ent)
        if gerr:
            raise RuntimeError(gerr)
        print(f"CREATED ledger id={ent.id} je_id={je.id if je else None} amt={AMOUNT} date={ENTRY_DATE}")

pl = compute_aquaculture_pl_summary_dict(pond.company_id, start, end, POND_ID, None, None, False)
row = next(x for x in pl["ponds"] if x["pond_id"] == POND_ID)
print(f"PL {start}..{end}: income={row['income_total']} expense={row['expense_total']} net={row['net_profit']}")
for item in pl.get("expenses_by_category") or []:
    if item.get("category") == "lease":
        print(f"lease_category={item['amount']}")
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
