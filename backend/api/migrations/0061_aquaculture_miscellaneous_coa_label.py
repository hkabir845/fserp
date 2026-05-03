from django.db import migrations


def forwards(apps, schema_editor):
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    ChartOfAccount.objects.filter(account_code="6725").update(
        account_name="Aquaculture Expense — Miscellaneous & other operating",
        description=(
            "Miscellaneous pond costs (code other): boats, wiring, lighting, cameras, engines, aerators, nets, "
            "repairs, bikes, labour, site consumables, and items not mapped to a dedicated category."
        ),
    )


def backwards(apps, schema_editor):
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    ChartOfAccount.objects.filter(account_code="6725").update(
        account_name="Aquaculture Expense — Other Operating",
        description="Other pond operating costs (other category).",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0060_aquaculture_split_feed_medicine_expense_categories"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
