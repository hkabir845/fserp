"""Upload audit command and run on VPS."""
from pathlib import Path
import paramiko
import sys

HOST = "mahasoftcorporation.com"
USER = "sas"
PASSWORD = "sas_corporation_noob"

FILES = [
    (
        Path(__file__).resolve().parents[1] / "backend/api/management/commands/audit_aquaculture_accounting.py",
        "/home/sas/fserp/fserp/backend/api/management/commands/audit_aquaculture_accounting.py",
    ),
    (
        Path(__file__).resolve().parents[1] / "backend/api/management/commands/fix_digonto_growout_pl.py",
        "/home/sas/fserp/fserp/backend/api/management/commands/fix_digonto_growout_pl.py",
    ),
]


def run_remote(cmd: str) -> tuple[int, str, str]:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    sftp = c.open_sftp()
    for local, remote in FILES:
        if local.exists():
            with sftp.file(remote, "w") as f:
                f.write(local.read_text(encoding="utf-8"))
    sftp.close()
    stdin, stdout, stderr = c.exec_command(cmd, timeout=600)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    c.close()
    return code, out, err


if __name__ == "__main__":
    fix_gl = "--fix-transfer-gl" in sys.argv
    flag = " --fix-transfer-gl" if fix_gl else ""
    cmd = (
        "cd ~/fserp/fserp/backend && source venv/bin/activate && "
        f"python manage.py audit_aquaculture_accounting --company-id 2 --json{flag}"
    )
    print("Running:", cmd)
    code, out, err = run_remote(cmd)
    out_path = Path(__file__).resolve().parent / "_vps_audit_result.json"
    out_path.write_text(out, encoding="utf-8")
    print(f"Wrote {out_path} ({len(out)} bytes)")
    if err:
        print("ERR:", err)
    raise SystemExit(code)
