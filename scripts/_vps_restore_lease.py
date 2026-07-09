"""Restore wrongly deleted lease entries and apply correct excess-only trim."""
import paramiko
from pathlib import Path

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Greatest

from api.models import AquacultureLandlord, AquacultureLandlordLedgerEntry, AquaculturePond
from api.services.gl_posting import sync_landlord_lease_payment_journal

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def reverse_lease_paid(cid, ent):
    if ent.applies_to_lease_paid and ent.pond_id and ent.lease_paid_delta is not None:
        dec = money(ent.lease_paid_delta)
        AquaculturePond.objects.filter(pk=ent.pond_id, company_id=cid).update(
            lease_paid_to_landlord=Greatest(F("lease_paid_to_landlord") - dec, Value(Decimal("0")))
        )

def landlord_for_pond(cid, pond_id):
    from api.models import AquacultureLandlordPondShare
    sh = AquacultureLandlordPondShare.objects.filter(pond_id=pond_id, landlord__company_id=cid).select_related("landlord").first()
    return sh.landlord if sh else AquacultureLandlord.objects.filter(company_id=cid).first()

def recreate(cid, pond_code, rows):
    pond = AquaculturePond.objects.get(company_id=cid, code=pond_code)
    ll = landlord_for_pond(cid, pond.id)
    bank = 5
    created = 0
    for entry_date, amt, memo in rows:
        ent = AquacultureLandlordLedgerEntry.objects.create(
            landlord_id=ll.id,
            pond_id=pond.id,
            entry_date=entry_date,
            kind=AquacultureLandlordLedgerEntry.KIND_PAYMENT,
            amount_signed=-money(amt),
            memo=memo,
            applies_to_lease_paid=True,
            lease_paid_delta=money(amt),
            bank_account_id=bank,
            payment_method="bank",
        )
        AquaculturePond.objects.filter(pk=pond.id).update(
            lease_paid_to_landlord=F("lease_paid_to_landlord") + money(amt)
        )
        sync_landlord_lease_payment_journal(cid, ent)
        created += 1
        print(f"  restored {pond_code} {entry_date} {amt} -> ent#{ent.id}")
    return created

cid = 2
P02_ROWS = [
    (date(2026,5,5), Decimal("461500"), "Leasemoney for Mynuddin"),
    (date(2026,5,5), Decimal("17500"), "Leasemoney to Sohel for Digonto"),
    (date(2026,5,5), Decimal("15000"), "Leasemoney to Sikander for Mynuddin"),
    (date(2026,5,11), Decimal("3150"), "Leasemoney to Veju landlords of Mynuddin"),
    (date(2026,5,11), Decimal("10200"), "Leasemoney to Khurshed for Mynuddin"),
    (date(2026,5,19), Decimal("16200"), ""),
    (date(2026,5,22), Decimal("17500"), ""),
    (date(2026,5,22), Decimal("10300"), ""),
    (date(2026,5,26), Decimal("30000"), "Small pond and Godown rent for Mynuddin"),
]
P03_ROWS = [
    (date(2026,5,17), Decimal("1369110"), "Leasemoney to landlords of  Ashari - 2"),
    (date(2026,6,7), Decimal("84725"), "Leasemoney to Rashidul"),
]

print("=== RESTORE DELETED LEASE ENTRIES ===")
with transaction.atomic():
    recreate(cid, "P02", P02_ROWS)
    recreate(cid, "P03", P03_ROWS)

print("\n=== CORRECT EXCESS-ONLY TRIM ===")
from api.services.gl_posting import delete_landlord_lease_payment_journal

def trim_excess_only(cid, code, start, end, tolerance=Decimal("5000")):
    pond = AquaculturePond.objects.get(company_id=cid, code=code)
    annual = money(pond.leasing_area_decimal * pond.lease_price_per_decimal_per_year)
    ents = list(AquacultureLandlordLedgerEntry.objects.filter(
        landlord__company_id=cid, pond_id=pond.id, kind="payment",
        entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False,
    ).order_by("-entry_date", "-id"))
    total = money(sum(abs(money(e.amount_signed or 0)) for e in ents))
    was = total
    if total <= annual:
        print(f"{code}: total {total} <= annual {annual}, skip")
        return
    deleted = []
    for ent in ents:
        if total <= annual:
            break
        amt = money(abs(ent.amount_signed or 0))
        if total - amt < annual - tolerance:
            continue
        deleted.append((ent.id, ent.entry_date, amt))
        total = money(total - amt)
        reverse_lease_paid(cid, ent)
        delete_landlord_lease_payment_journal(cid, ent.id)
        ent.delete()
    print(f"{code}: annual={annual} was={was} now={total} deleted={len(deleted)}")
    for d in deleted:
        print(f"  del #{d[0]} {d[1]} {d[2]}")

start, end = date(2025,7,1), date(2026,6,30)
with transaction.atomic():
    trim_excess_only(cid, "P02", start, end)
    trim_excess_only(cid, "P03", start, end)

print("\n=== REPOST TRANSFER #8 GL ===")
from api.models import AquacultureFishPondTransfer
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
tr = AquacultureFishPondTransfer.objects.get(pk=8)
r = sync_aquaculture_fish_pond_transfer_gl(cid, tr)
print(f"xfer#8 posted={r.get('posted')} amount={r.get('total_gl_amount')} line_total={sum(l.cost_amount or 0 for l in tr.lines.all())}")

print("\n=== P06 NURSING RECONCILE FY PERIOD ===")
import subprocess
subprocess.run(["python", "manage.py", "reconcile_nursing_pond_pl_balance", "--company-id", "2", "--pond-code", "P06", "--period-end", "2026-06-30"], check=False)
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password=PASSWORD, timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=900)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
Path(__file__).resolve().parent.joinpath("_vps_restore_result.txt").write_text(out, encoding="utf-8")
print("saved restore result", len(out))
c.close()
