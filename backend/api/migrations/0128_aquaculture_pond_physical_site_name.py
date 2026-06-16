from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0127_fixed_asset_company_wide"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="physical_site_name",
            field=models.CharField(
                blank=True,
                default="",
                help_text=(
                    "Optional shared water-body name when one physical pond is tracked as nursing then "
                    "grow-out (e.g. Digonta). Used for contextual labels: nursing phase vs fingerling grow-out."
                ),
                max_length=120,
            ),
        ),
    ]
