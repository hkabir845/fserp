"""Apply VPS accounting fixes: GL backfill, nursing reconcile, lease trim, transfer GL."""
from pathlib import Path
import paramiko

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

# Upload management commands
UPLOAD = [
    "audit_aquaculture_accounting.py",
    "fix_digonto_growout_pl.py",
    "reconcile_nursing_pond_pl_balance.py",
]

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate

echo "=== 1. GL BACKFILL ==="
python manage.py backfill_gl_posting_gaps --company-id 2 2>&1

echo ""
echo "=== 2. NURSING P06 RECONCILE ==="
python manage.py reconcile_nursing_pond_pl_balance --company-id 2 --pond-code P06 2>&1

echo ""
echo "=== 3. NURSING P07 RECONCILE ==="
python manage.py reconcile_nursing_pond_pl_balance --company-id 2 --pond-code P07 2>&1

echo ""
echo "=== 4. TRANSFER GL RESYNC ==="
python manage.py audit_aquaculture_accounting --company-id 2 --fix-transfer-gl 2>&1 | tail -20

echo ""
echo "=== 5. LEASE TRIM P02 P03 ==="
python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Greatest

from api.models import AquacultureLandlordLedgerEntry, AquaculturePond, Company
from api.services.gl_posting import delete_landlord_lease_payment_journal

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def reverse_lease_paid(cid, ent):
    if ent.applies_to_lease_paid and ent.pond_id and ent.lease_paid_delta is not None:
        dec = money(ent.lease_paid_delta)
        AquaculturePond.objects.filter(pk=ent.pond_id, company_id=cid).update(
            lease_paid_to_landlord=Greatest(F("lease_paid_to_landlord") - dec, Value(Decimal("0")))
        )

def trim_pond(cid, code, start, end):
    pond = AquaculturePond.objects.get(company_id=cid, code=code)
    annual = money(pond.leasing_area_decimal * pond.lease_price_per_decimal_per_year)
    ents = list(AquacultureLandlordLedgerEntry.objects.filter(
        landlord__company_id=cid, pond_id=pond.id, kind="payment",
        entry_date__gte=start, entry_date__lte=end, bank_account_id__isnull=False,
    ).order_by("-entry_date", "-id"))
    total = money(sum(abs(money(e.amount_signed or 0)) for e in ents))
    if total <= annual:
        print(f"{code}: total {total} <= annual {annual}, no trim")
        return
    was = total
    deleted = []
    for ent in ents:
        if total <= annual:
            break
        amt = money(abs(ent.amount_signed or 0))
        deleted.append((ent.id, ent.entry_date, amt, ent.memo[:40] if ent.memo else ""))
        total = money(total - amt)
        reverse_lease_paid(cid, ent)
        delete_landlord_lease_payment_journal(cid, ent.id)
        ent.delete()
    print(f"{code}: annual={annual} was={was} now={total} deleted={len(deleted)}")
    for row in deleted:
        print(f"  del #{row[0]} {row[1]} {row[2]} {row[3]}")

cid = 2
start, end = date(2025,7,1), date(2026,6,30)
with transaction.atomic():
    trim_pond(cid, "P02", start, end)
    trim_pond(cid, "P03", start, end)
PY

echo ""
echo "=== 6. FINAL AUDIT ==="
python manage.py audit_aquaculture_accounting --company-id 2 --json 2>&1
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = c.open_sftp()
    base = Path(__file__).resolve().parents[1] / "backend/api/management/commands"
    for name in UPLOAD:
        local = base / name
        if local.exists():
            remote = f"/home/sas/fserp/fserp/backend/api/management/commands/{name}"
            with sftp.file(remote, "w") as f:
                f.write(local.read_text(encoding="utf-8"))
    sftp.close()
    stdin, stdout, stderr = c.exec_command("bash -s", timeout=900)
    stdin.write(SCRIPT)
    stdin.flush()
    stdin.channel.shutdown_write()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    out_path = Path(__file__).resolve().parent / "_vps_fix_result.txt"
    out_path.write_text(out + "\nERR:\n" + err, encoding="utf-8")
    print(f"Wrote {out_path}")
    c.close()

if __name__ == "__main__":
    main()
