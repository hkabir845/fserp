# Generated manually

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0070_aquaculture_biomass_sample_fish_species"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendor",
            name="default_aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional default pond for fish/fry deliveries; new bills use linked shop site stock when configured.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vendors_preferred_delivery_pond",
                to="api.aquaculturepond",
            ),
        ),
    ]
