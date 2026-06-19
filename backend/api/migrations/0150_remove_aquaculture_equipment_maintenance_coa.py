"""Remove COA 6723 added by 0149 (undo Aquaculture Expense — Equipment & Maintenance)."""

from django.db import migrations


def remove_equipment_maintenance_coa(apps, schema_editor):
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    ChartOfAccount.objects.filter(account_code="6723").delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0149_aquaculture_equipment_maintenance_coa"),
    ]

    operations = [
        migrations.RunPython(remove_equipment_maintenance_coa, noop_reverse),
    ]
