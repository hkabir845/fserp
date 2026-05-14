# Optional: attribute payroll subledger lines to one employee (from-one-employee).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0092_employeeledgerentry_payroll_run"),
    ]

    operations = [
        migrations.AddField(
            model_name="payrollrun",
            name="subledger_employee",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_subledger",
                to="api.employee",
                help_text="When set (from-one-employee), posted payroll subledger lines are attributed entirely to this person.",
            ),
        ),
    ]
