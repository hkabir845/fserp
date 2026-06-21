from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0152_biomass_sample_valuation"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="language",
            field=models.CharField(
                default="en",
                help_text="UI and aquaculture advice language: en (English) or bn (Bangla).",
                max_length=8,
            ),
        ),
    ]
