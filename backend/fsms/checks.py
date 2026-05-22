"""Django system checks (e.g. `manage.py check --deploy`).

Production deploy warnings (SQLite, LocMem, SMTP, WhiteNoise) live in ``api.checks`` with
stable ids fserp.W001–W004. This module is kept for backwards-compatible imports only.
"""
