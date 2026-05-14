# Generated manually for payroll → employee subledger link

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0091_gl_default_accounts_items_vendor_bills"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeledgerentry",
            name="payroll_run",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="employee_ledger_entries",
                to="api.payrollrun",
            ),
        ),
    ]
