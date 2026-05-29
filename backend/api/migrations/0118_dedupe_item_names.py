from django.db import migrations


def dedupe_item_names(apps, schema_editor):
    from api.services.item_name_uniqueness import dedupe_all_company_item_names

    dedupe_all_company_item_names()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0115_employee_pl_opening_gl"),
    ]

    operations = [
        migrations.RunPython(dedupe_item_names, noop_reverse),
    ]
