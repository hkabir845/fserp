from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0137_aquaculture_pond_prior_pl_zero_confirmed"),
    ]

    operations = [
        migrations.CreateModel(
            name="PayrollRunEmployeeAllocation",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                (
                    "employee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payroll_wage_allocations",
                        to="api.employee",
                    ),
                ),
                (
                    "payroll_run",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="employee_allocations",
                        to="api.payrollrun",
                    ),
                ),
            ],
            options={
                "db_table": "payroll_run_employee_allocation",
                "indexes": [
                    models.Index(fields=["employee"], name="payroll_run_emp_id_idx")
                ],
                "unique_together": {("payroll_run", "employee")},
            },
        ),
    ]
