# Manual employee ledger rows post AUTO-EMP-LE-{id} journals.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0184_payroll_settle_and_remit_journals"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeledgerentry",
            name="journal_entry",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-EMP-LE-{this row id} when a manual line is posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="employee_ledger_entries",
                to="api.journalentry",
            ),
        ),
    ]
