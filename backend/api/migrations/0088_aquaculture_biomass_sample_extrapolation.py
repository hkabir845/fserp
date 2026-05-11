# Generated manually for biomass sampling extrapolation vs fish stock position.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0087_bill_line_aquaculture_fish_dims"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="stock_reference_fish_count",
            field=models.IntegerField(
                blank=True,
                null=True,
                help_text="Implied net head count from transfers, bills, sales, and stock ledger (same basis as Fish stock), snapshot at save.",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="stock_reference_net_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                max_digits=14,
                null=True,
                help_text="Implied net biological kg for the species, snapshot at save.",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="stock_reference_avg_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=6,
                max_digits=14,
                null=True,
                help_text="stock_reference_net_weight_kg / stock_reference_fish_count when both positive.",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="extrapolated_biomass_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                max_digits=14,
                null=True,
                help_text="Sample mean weight × stock_reference_fish_count (estimated total biomass in pond).",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="biomass_gain_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                max_digits=14,
                null=True,
                help_text="(sample mean − stock reference mean) × stock_reference_fish_count; may be negative.",
            ),
        ),
    ]
