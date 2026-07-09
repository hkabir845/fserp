"""Upload fix_digonto_growout_pl command to VPS and run it."""
from pathlib import Path
import paramiko
import sys

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

LOCAL_CMD = Path(__file__).resolve().parents[1] / "backend/api/management/commands/fix_digonto_growout_pl.py"
REMOTE_CMD = "~/fserp/fserp/backend/api/management/commands/fix_digonto_growout_pl.py"


def main() -> int:
    apply = "--apply" in sys.argv
    body = LOCAL_CMD.read_text(encoding="utf-8")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    sftp = c.open_sftp()
    with sftp.file(REMOTE_CMD.replace("~", "/home/sas"), "w") as f:
        f.write(body)
    sftp.close()

    flag = "" if apply else " --dry-run"
    cmd = f"cd ~/fserp/fserp/backend && source venv/bin/activate && python manage.py fix_digonto_growout_pl --company-id 2{flag}"
    print("Running:", cmd)
    stdin, stdout, stderr = c.exec_command(cmd, timeout=300)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    print(out)
    if err:
        print("ERR:", err, file=sys.stderr)
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
