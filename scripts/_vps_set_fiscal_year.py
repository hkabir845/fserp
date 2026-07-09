"""Set Adib Filling Station fiscal year start to 02-20 on VPS."""
import paramiko

SCRIPT = r'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python <<'PY'
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
django.setup()

from api.models import Company
c = Company.objects.get(pk=2)
print(f"before: {c.name} fiscal_year_start={c.fiscal_year_start}")
c.fiscal_year_start = "02-20"
c.save(update_fields=["fiscal_year_start"])
c.refresh_from_db()
print(f"after: fiscal_year_start={c.fiscal_year_start}")
PY
'''

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("mahasoftcorporation.com", username="sas", password="sas_corporation_noob", timeout=30)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=60)
stdin.write(SCRIPT)
stdin.flush()
stdin.channel.shutdown_write()
print(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
if err:
    print("STDERR:", err)
c.close()
