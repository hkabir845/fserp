"""Rename chart account 3000 to match updated fuel_station template label."""

from django.db import migrations

NEW_NAME = "Owner Equity / Shareholder Capital"


def rename_account_3000(apps, schema_editor):
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    ChartOfAccount.objects.filter(account_code="3000").update(account_name=NEW_NAME)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0006_hardening_allocations_shift_cogs"),
    ]

    operations = [
        migrations.RunPython(rename_account_3000, noop_reverse),
    ]
