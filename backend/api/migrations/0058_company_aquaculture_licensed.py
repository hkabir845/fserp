# Generated manually: split SaaS license vs tenant opt-in for Aquaculture.

from django.db import migrations, models


def forwards_license_from_enabled(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    Company.objects.filter(aquaculture_enabled=True).update(aquaculture_licensed=True)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0057_seed_aquaculture_chart_of_accounts"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="aquaculture_licensed",
            field=models.BooleanField(
                default=False,
                help_text="SaaS: tenant is allowed to opt in to Aquaculture. Tenant Admin turns on aquaculture_enabled in Company settings.",
            ),
        ),
        migrations.RunPython(forwards_license_from_enabled, migrations.RunPython.noop),
    ]
