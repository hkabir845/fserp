# Generated manually for materializing historical fish transfers as sales.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0195_fix_pond_water_area_extra_zero"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturefishsale",
            name="source_fish_pond_transfer_line",
            field=models.OneToOneField(
                blank=True,
                help_text=(
                    "When set, this sale mirrors a historical inter-pond fish transfer line. "
                    "The transfer row stays for stock history; this sale is the commercial view "
                    "(fingerling/inter-pond sale). Stock math still uses the transfer, not this sale."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="materialized_fish_sale",
                to="api.aquaculturefishpondtransferline",
            ),
        ),
    ]
