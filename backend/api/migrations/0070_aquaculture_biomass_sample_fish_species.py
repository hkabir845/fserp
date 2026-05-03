# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0069_aquaculture_fish_stock_ledger"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="fish_species",
            field=models.CharField(
                db_index=True,
                default="tilapia",
                help_text="Species this biomass estimate refers to (polyculture).",
                max_length=64,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="fish_species_other",
            field=models.CharField(
                blank=True,
                help_text="When fish_species is 'other', optional name (e.g. local variety).",
                max_length=120,
            ),
        ),
    ]
