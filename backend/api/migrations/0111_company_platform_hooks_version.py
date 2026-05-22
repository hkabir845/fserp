from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0110_aquaculture_warehouse_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="platform_hooks_version",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
