# Seed built-in Aquaculture COA for companies that already have the module enabled.

from django.db import migrations


def forwards(apps, schema_editor):
    from api.services.aquaculture_coa_seed import seed_aquaculture_coa_for_all_enabled_companies

    seed_aquaculture_coa_for_all_enabled_companies()


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0056_aquaculture_profit_center_cycles_shares_income"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
