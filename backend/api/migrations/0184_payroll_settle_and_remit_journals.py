# Accrue-then-pay and statutory remittance journals on PayrollRun.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0183_journal_attribution_and_loan_accrual_period"),
    ]

    operations = [
        migrations.AddField(
            model_name="payrollrun",
            name="net_pay_journal",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_net_pay",
                to="api.journalentry",
            ),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="deduction_remittance_journal",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_deduction_remit",
                to="api.journalentry",
            ),
        ),
    ]
