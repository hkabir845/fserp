# Generated manually — earning breakdown for gross pay (base, OT, bonus, other).

from decimal import Decimal

from django.db import migrations, models


def backfill_base_from_gross(apps, schema_editor):
    PayrollRun = apps.get_model("api", "PayrollRun")
    for row in PayrollRun.objects.all().only("id", "total_gross", "base_salary_total"):
        g = row.total_gross or Decimal("0")
        if g and not row.base_salary_total:
            PayrollRun.objects.filter(pk=row.pk).update(base_salary_total=g)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0042_item_reporting_category_required"),
    ]

    operations = [
        migrations.AddField(
            model_name="payrollrun",
            name="base_salary_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="overtime_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="bonus_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="other_earnings_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.RunPython(backfill_base_from_gross, migrations.RunPython.noop),
    ]
