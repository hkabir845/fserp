"""Add company_wide flag for shared head-office fixed assets."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0126_fixed_asset_depreciation_reversal"),
    ]

    operations = [
        migrations.AddField(
            model_name="fixedasset",
            name="company_wide",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Shared / head-office asset (e.g. manager vehicle). Depreciation expense is not "
                    "tagged to a station or pond — appears on company-wide P&L only."
                ),
            ),
        ),
    ]
