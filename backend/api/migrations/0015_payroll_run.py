# Generated manually for PayrollRun

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0014_loan_management"),
    ]

    operations = [
        migrations.CreateModel(
            name="PayrollRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("payroll_number", models.CharField(blank=True, max_length=64)),
                ("pay_period_start", models.DateField()),
                ("pay_period_end", models.DateField()),
                ("payment_date", models.DateField()),
                ("total_gross", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total_deductions", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total_net", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("status", models.CharField(default="draft", max_length=32)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payroll_runs",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "payroll_run",
                "ordering": ["-payment_date", "-id"],
            },
        ),
    ]
