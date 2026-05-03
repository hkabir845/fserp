from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0058_company_aquaculture_licensed"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="lease_contract_end",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="lease_contract_start",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="lease_paid_to_landlord",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=18),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="lease_price_per_decimal_per_year",
            field=models.DecimalField(blank=True, decimal_places=4, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="pond_size_decimal",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Pond area in decimal units (land measure).",
                max_digits=14,
                null=True,
            ),
        ),
    ]
