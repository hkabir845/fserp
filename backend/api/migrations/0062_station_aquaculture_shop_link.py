# Generated manually for aquaculture ↔ shop integration.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0061_aquaculture_miscellaneous_coa_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="station",
            name="default_aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional default pond for aquaculture shop stock issues and expense defaults at this location.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="stations_default_shop_outlet",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AddField(
            model_name="aquacultureexpense",
            name="source_station",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, this pond cost was created from a shop stock issue at this station.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_expenses_from_shop",
                to="api.station",
            ),
        ),
    ]
