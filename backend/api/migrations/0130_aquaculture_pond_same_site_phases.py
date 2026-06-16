from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0129_aquaculture_pond_virtual_nursing"),
    ]

    operations = [
        migrations.AlterField(
            model_name="aquaculturepond",
            name="is_virtual",
            field=models.BooleanField(
                default=False,
                help_text="Deprecated — all ponds are physical. Do not use.",
            ),
        ),
        migrations.AlterField(
            model_name="aquaculturepond",
            name="linked_grow_out_pond",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "For nursing-role ponds: grow-out profit center on the same physical site "
                    "(remainder fingerlings after nursing transfers, e.g. Mynuddin Nursing → Mynuddin Pond)."
                ),
                null=True,
                on_delete=models.SET_NULL,
                related_name="same_site_nursing_phases",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AlterField(
            model_name="aquaculturepond",
            name="physical_site_name",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "Shared water-body name for ponds on the same physical site (e.g. Mynuddin). "
                    "Use with a nursing-phase and grow-out-phase profit center per site."
                ),
                max_length=120,
            ),
        ),
    ]
