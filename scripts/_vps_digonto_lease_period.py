"""Lease + expense diff for Digonto Feb-Feb period vs 765k."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from api.models import AquaculturePond
from api.services.aquaculture_cost_per_kg import landlord_lease_payment_pond_journal_qs

def money(d):
    return Decimal(str(d)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

pond = AquaculturePond.objects.get(code="P04")
start, end = date(2025,2,20), date(2026,2,20)
qs = landlord_lease_payment_pond_journal_qs(
    company_id=pond.company_id, pond_id=pond.id, start=start, end=end, cycle_filter_id=None
)
total = Decimal("0")
for line in qs.select_related("journal_entry", "account").order_by("journal_entry__date"):
    amt = money(line.debit - line.credit)
    total += amt
    je = line.journal_entry
    print(f"{je.date} JE#{je.id} {je.reference or je.memo or ''}: {amt}")
print(f"lease_total={money(total)}")

# what net if lease were 676500
inc = Decimal("4883586.98")
exp = Decimal("4095702.53")
lease_now = Decimal("658000")
for target_lease in [Decimal("676500"), Decimal("672000")]:
    adj_exp = exp - lease_now + target_lease
    print(f"if lease={target_lease}: expense={money(adj_exp)} net={money(inc-adj_exp)}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=120)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print(out)
if err:
    print("STDERR:", err)
c.close()
