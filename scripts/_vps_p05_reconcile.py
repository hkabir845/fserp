"""Run reconcile_nursing_pond_pl_balance for P05 on VPS."""
import paramiko
import sys

dry = "--dry-run" in sys.argv

SCRIPT = rf'''
cd ~/fserp/fserp/backend && source venv/bin/activate && python manage.py reconcile_nursing_pond_pl_balance \
  --company-id 2 --pond-code P05 \
  --period-start 2025-02-20 --period-end 2026-02-20 \
  {"--dry-run" if dry else ""}
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
