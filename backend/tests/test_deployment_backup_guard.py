"""Deployment must stop before migrations when a required backup cannot be taken."""
import os
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.mark.parametrize("database_url", ["", "postgresql://unused/test"])
def test_deploy_requires_backup_prerequisites(database_url):
    git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
    bash = str(git_bash) if os.name == "nt" and git_bash.exists() else shutil.which("bash")
    if not bash:
        pytest.skip("Bash is required to verify the Linux deploy script")
    source = (Path(__file__).resolve().parents[2] / "scripts/deploy-vps.sh").read_text(encoding="utf-8")
    block = source[source.index('if [[ "${FSERP_SKIP_BACKUP'):source.index('echo "==> Backend: migrate')]
    # Simulate an unavailable pg_dump. No connection or backup command is executed.
    script = 'command() { return 1; }\n' + block
    env = {**os.environ, "DATABASE_URL": database_url, "FSERP_SKIP_BACKUP": "0"}
    result = subprocess.run([bash, "-c", script], env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 1
    assert "refusing to migrate" in result.stderr


@pytest.mark.parametrize("status,expected_exit", [("400", 0), ("404", 1), ("500", 1), ("000", 1)])
def test_deploy_rejects_unhealthy_login(status, expected_exit):
    git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
    bash = str(git_bash) if os.name == "nt" and git_bash.exists() else shutil.which("bash")
    if not bash:
        pytest.skip("Bash is required to verify the Linux deploy script")
    source = (Path(__file__).resolve().parents[2] / "scripts/deploy-vps.sh").read_text(encoding="utf-8")
    block = source[source.index('login_code="'):source.index('# The FastAPI/Alembic')]
    # Simulate HTTP statuses without contacting any application or sending credentials.
    script = 'curl() { echo "$SIMULATED_STATUS"; }\n' + block
    result = subprocess.run([bash, "-c", script],
        env={**os.environ, "SIMULATED_STATUS": status}, capture_output=True, text=True, timeout=10)
    assert result.returncode == expected_exit
