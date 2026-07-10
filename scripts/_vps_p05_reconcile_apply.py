"""Balance P05 nursing pond P&L on VPS (inline reconcile)."""
import paramiko
import sys

dry = "--dry-run" in sys.argv

SCRIPT = rf'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction

from api.models import AquacultureFishPondTransfer, AquacultureFishPondTransferLine, AquaculturePond
from api.services.aquaculture_fish_transfer_gl_service import sync_aquaculture_fish_pond_transfer_gl
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict
from api.services.aquaculture_transfer_cost import resync_nursing_pond_transfer_costs

DRY = {str(dry)}

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def pl_row(cid, pid, start, end):
    pl = compute_aquaculture_pl_summary_dict(cid, start, end, pid, None, None, False)
    return next(x for x in pl["ponds"] if x["pond_id"] == pid)

def gap(row):
    return money(Decimal(str(row["expense_total"])) - Decimal(str(row["income_total"])))

def distribute(lines, g):
    active = [ln for ln in lines if int(ln.fish_count or 0) > 0]
    if not active or g <= 0:
        return []
    total_fish = sum(int(ln.fish_count or 0) for ln in active)
    bumps = []
    running = Decimal("0")
    for i, ln in enumerate(active):
        fc = int(ln.fish_count or 0)
        if i == len(active) - 1:
            bump = money(g - running)
        else:
            bump = money(g * Decimal(fc) / Decimal(total_fish))
            running += bump
        bumps.append(bump)
    out = []
    for ln, bump in zip(active, bumps):
        old = money(ln.cost_amount)
        new = money(old + bump)
        if new != old:
            out.append((ln, old, new))
    return out

cid = 2
start, end = date(2025,2,20), date(2026,2,20)
pond = AquaculturePond.objects.get(code="P05")
row = pl_row(cid, pond.id, start, end)
print(f"BEFORE income={{row['income_total']}} expense={{row['expense_total']}} net={{row['net_profit']}} gap={{gap(row)}}")

with transaction.atomic():
    n = resync_nursing_pond_transfer_costs(
        company_id=cid, from_pond_id=pond.id, from_production_cycle_id=None, sync_gl=False
    )
    print(f"resync updated {{n}} line(s)")
    row = pl_row(cid, pond.id, start, end)
    g = gap(row)
    print(f"AFTER resync income={{row['income_total']}} expense={{row['expense_total']}} net={{row['net_profit']}} gap={{g}}")

    if g > Decimal("0.01"):
        lines = list(AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=cid, transfer__from_pond_id=pond.id,
        ).select_related("transfer", "to_pond").order_by("transfer__transfer_date", "id"))
        changes = distribute(lines, g)
        print(f"distributing gap {{g}} across {{len(changes)}} line(s)")
        xfer_ids = set()
        for ln, old, new in changes:
            print(f"  line {{ln.id}} xfer#{{ln.transfer_id}} -> {{ln.to_pond.code}} fish={{ln.fish_count}}: {{old}} -> {{new}}")
            if not DRY:
                ln.cost_amount = new
                ln.save(update_fields=["cost_amount"])
            xfer_ids.add(ln.transfer_id)
        if not DRY:
            for tid in sorted(xfer_ids):
                xfer = AquacultureFishPondTransfer.objects.get(pk=tid)
                sync_aquaculture_fish_pond_transfer_gl(cid, xfer)
                print(f"  reposted GL xfer#{{tid}}")

    row = pl_row(cid, pond.id, start, end)
    print(f"FINAL income={{row['income_total']}} expense={{row['expense_total']}} net={{row['net_profit']}}")
    if DRY:
        transaction.set_rollback(True)
        print("DRY RUN — rolled back")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=300)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
if err:
    print("STDERR:", err)
c.close()
