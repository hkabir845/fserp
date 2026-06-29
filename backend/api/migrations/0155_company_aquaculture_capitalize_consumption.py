from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0154_backfill_biomass_sample_extrapolation"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="aquaculture_capitalize_pond_consumption_to_bioasset",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "When true, pond feed/medicine warehouse consumption posts Dr 1581 Biological Inventory "
                    "instead of Dr COGS, so direct pond inputs accumulate in the bio-asset GL account."
                ),
            ),
        ),
    ]
