from django.db import migrations, models


def enable_capitalize_for_aquaculture_licensed(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    Company.objects.filter(aquaculture_licensed=True).update(
        aquaculture_capitalize_pond_consumption_to_bioasset=True
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0155_company_aquaculture_capitalize_consumption"),
    ]

    operations = [
        migrations.AlterField(
            model_name="company",
            name="aquaculture_capitalize_pond_consumption_to_bioasset",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "When true, direct pond inputs (fry, feed, medicine, pond care, equipment, etc.) "
                    "post Dr 1581 Biological Inventory instead of immediate operating expense/shop "
                    "inventory, so pond liability accumulates on the bio-asset GL account and is "
                    "relieved on harvest or inter-pond transfer."
                ),
            ),
        ),
        migrations.RunPython(enable_capitalize_for_aquaculture_licensed, migrations.RunPython.noop),
    ]
