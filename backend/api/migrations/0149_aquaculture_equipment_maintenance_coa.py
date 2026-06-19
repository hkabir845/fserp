"""Add built-in COA 6723 Aquaculture Expense — Equipment & Maintenance for aquaculture tenants."""

from django.db import migrations


def seed_equipment_maintenance_coa(apps, schema_editor):
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
    from api.models import Company

    for cid in Company.objects.filter(is_deleted=False, aquaculture_enabled=True).values_list(
        "id", flat=True
    ):
        ensure_aquaculture_chart_accounts(int(cid))


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0148_invoice_line_entity_tags"),
    ]

    operations = [
        migrations.RunPython(seed_equipment_maintenance_coa, noop_reverse),
    ]
