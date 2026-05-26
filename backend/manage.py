#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import subprocess
import sys


def _project_venv_pythons():
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(backend_dir)
    for base, name in ((repo_root, ".venv-local"), (repo_root, ".venv"), (backend_dir, "venv")):
        yield os.path.join(base, name, "Scripts", "python.exe")


def _reexec_with_project_venv():
    if os.environ.get("FSERP_MANAGE_REEXEC"):
        return False
    current = os.path.normcase(os.path.abspath(sys.executable))
    env = {**os.environ, "FSERP_MANAGE_REEXEC": "1"}
    for venv_py in _project_venv_pythons():
        if not os.path.isfile(venv_py):
            continue
        if os.path.normcase(os.path.abspath(venv_py)) == current:
            continue
        raise SystemExit(subprocess.call([venv_py, *sys.argv], env=env))
    return False


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "fsms.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        if not _reexec_with_project_venv():
            raise ImportError(
                "Couldn't import Django. Are you sure it's installed and "
                "available on your PYTHONPATH? Did you forget to activate a "
                "virtual environment? From the repo root run: "
                "powershell -File scripts\\dev-setup.ps1"
            ) from exc
        return
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
