"""Merge the employee-ledger and refresh-session migration branches."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0185_employee_ledger_journal"),
        ("api", "0186_auth_refresh_session"),
    ]

    operations = []
