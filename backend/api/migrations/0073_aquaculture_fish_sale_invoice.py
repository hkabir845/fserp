# Generated manually for aquaculture pond sale → invoice / GL link.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0072_aquaculture_biomass_sample_source_fish_sale"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="invoice",
            field=models.OneToOneField(
                blank=True,
                help_text="When set, this harvest line is booked through AR / cash sale GL (AUTO-INV-* journals).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_fish_sale",
                to="api.invoice",
            ),
        ),
    ]
