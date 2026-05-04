# Pond ↔ POS customer link; optional feed sack/kg on aquaculture expenses.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0063_aquaculture_fish_sale_species"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="pos_customer",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional AR customer for General POS: sell feed and supplies on account to this pond.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_ponds_pos",
                to="api.customer",
            ),
        ),
        migrations.AddField(
            model_name="aquacultureexpense",
            name="feed_sack_count",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Optional number of feed sacks for this line (feed purchase / shop issue).",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquacultureexpense",
            name="feed_weight_kg",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Optional total feed weight in kg (equivalent) for reporting.",
                max_digits=14,
                null=True,
            ),
        ),
    ]
