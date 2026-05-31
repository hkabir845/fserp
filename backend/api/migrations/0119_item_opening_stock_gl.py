from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0118_dedupe_item_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="opening_stock_quantity",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Go-live on-hand quantity treated as opening inventory (capitalized to the inventory asset, offset to Opening Balance Equity). Distinct from later bill receipts.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="opening_stock_unit_cost",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Unit cost used to value opening stock at go-live (opening value = opening_stock_quantity x this).",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="opening_balance_date",
            field=models.DateField(
                blank=True,
                help_text="As-of date for the opening inventory G/L entry (AUTO-ITEM-OB-{id}).",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-ITEM-OB-{item id} when opening stock is posted to the G/L (Dr inventory / Cr 3200).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="item_openings",
                to="api.journalentry",
            ),
        ),
    ]
