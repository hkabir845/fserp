# Track auto-created POS customer per pond for sync and lifecycle.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0064_aquaculture_pond_pos_customer_feed_metrics"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="auto_pos_customer",
            field=models.BooleanField(
                default=False,
                help_text="When true, pos_customer was created for this pond; display name and active flag sync from pond.",
            ),
        ),
    ]
