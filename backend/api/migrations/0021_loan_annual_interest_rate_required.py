from decimal import Decimal

from django.db import migrations, models


def fill_null_rates(apps, schema_editor):
    Loan = apps.get_model("api", "Loan")
    Loan.objects.filter(annual_interest_rate__isnull=True).update(annual_interest_rate=Decimal("0"))


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0020_loan_counterparty_fix_bank_default_role"),
    ]

    operations = [
        migrations.RunPython(fill_null_rates, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="loan",
            name="annual_interest_rate",
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal("0"),
                help_text="Annual interest % (0 for zero-interest); required on every loan.",
                max_digits=8,
            ),
        ),
    ]
