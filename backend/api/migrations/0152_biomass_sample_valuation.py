from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0151_production_cycle_species_lineage"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="market_price_per_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Optional market price (BDT/kg) for valuation at sample time.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="market_value",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="extrapolated_biomass_kg × market_price_per_kg when both are set.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="book_bioasset_value",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Bio-asset book value (1581 settlement) snapshot at save.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="book_cost_per_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Book bio-asset ÷ on-hand kg, or production cost/kg when settlement is unavailable.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="bioasset_margin",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="market_value − book_bioasset_value.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="bioasset_margin_per_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="market_price_per_kg − book_cost_per_kg.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="biological_production_cost",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Fry, feed, medicine, preparation, and transfer-in costs in the pond/cycle window.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="full_cost_base",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Total pond/cycle costs (operating expenses + payroll) in the valuation window.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="full_cycle_margin",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="market_value − full_cost_base.",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="full_cycle_margin_per_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Per-kg margin vs full_cost_base ÷ extrapolated biomass.",
                max_digits=14,
                null=True,
            ),
        ),
    ]
