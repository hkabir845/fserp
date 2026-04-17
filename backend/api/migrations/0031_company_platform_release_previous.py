# Generated manually for platform release rollback support.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0030_company_platform_release"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="platform_release_previous",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
    ]
