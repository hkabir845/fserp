"""Check Digonto P04 Data Bank close vs current P&L."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()
from api.models import AquaculturePond, AquacultureDataBankPondClose, AquacultureFishPondTransferLine
from api.services.aquaculture_pl_service import compute_aquaculture_pl_summary_dict

p04 = AquaculturePond.objects.get(code="P04")
closes = AquacultureDataBankPondClose.objects.filter(pond_id=p04.id).order_by("-period_end")
print("=== DATA BANK CLOSES P04 ===")
for c in closes:
    print(
        f"  id={c.id} label={c.label!r} {c.period_start}..{c.period_end} "
        f"locked={c.is_data_locked} closed_at={c.closed_at.date()}"
    )

if closes.exists():
    c = closes.first()
    pl = compute_aquaculture_pl_summary_dict(2, c.period_start, c.period_end, p04.id, None, None, False)
    r = next(x for x in pl["ponds"] if x["pond_id"] == p04.id)
    print(
        f"Archive period PL: income={r['income_total']} expense={r['expense_total']} "
        f"net={r['net_profit']}"
    )
    print(f"  xfer_in={r.get('fish_transfer_cost_in')} lease={r.get('lease_cost')}")

print("\n=== P05->P04 TRANSFER LINES ===")
p05 = AquaculturePond.objects.get(code="P05")
for ln in AquacultureFishPondTransferLine.objects.filter(
    transfer__from_pond_id=p05.id, to_pond_id=p04.id
).select_related("transfer").order_by("transfer__transfer_date"):
    tr = ln.transfer
    print(f"  line#{ln.id} xfer#{tr.id} {tr.transfer_date} fish={ln.fish_count} cost={ln.cost_amount}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode())
err = stderr.read().decode()
if err:
    print("ERR:", err)
c.close()
