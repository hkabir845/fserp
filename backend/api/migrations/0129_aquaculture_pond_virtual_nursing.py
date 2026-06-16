import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0128_aquaculture_pond_physical_site_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="is_virtual",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "When true with role=nursing: logical fry-holding profit center (no physical water body). "
                    "Stock fry here on bills, then transfer to production/grow-out ponds."
                ),
            ),
        ),
        migrations.AddField(
            model_name="aquaculturepond",
            name="linked_grow_out_pond",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Optional real grow-out pond for remainder fingerlings after nursing transfers "
                    "(suggested default on inter-pond transfer)."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="virtual_nursing_sources",
                to="api.aquaculturepond",
            ),
        ),
    ]
