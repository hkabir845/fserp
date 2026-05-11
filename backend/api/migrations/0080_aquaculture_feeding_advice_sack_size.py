from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0079_organization_tenant_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturefeedingadvice",
            name="sack_size_kg",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Commercial sack size (kg) for field instructions; optional.",
                null=True,
            ),
        ),
    ]
