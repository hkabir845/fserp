import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0071_vendor_default_aquaculture_pond"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="source_fish_sale",
            field=models.OneToOneField(
                blank=True,
                help_text="When set, this row was auto-created from that harvest sale (head count + kg).",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="biomass_sample_from_sale",
                to="api.aquaculturefishsale",
            ),
        ),
    ]
