from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0080_aquaculture_feeding_advice_sack_size"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="default_feed_item",
            field=models.ForeignKey(
                blank=True,
                help_text="Inventory SKU drawn from this pond's warehouse when feeding advice is applied (sack or kg unit).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="ponds_default_feed",
                to="api.item",
            ),
        ),
        migrations.CreateModel(
            name="ItemPondStock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="item_pond_stocks",
                        to="api.company",
                    ),
                ),
                (
                    "item",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_stocks",
                        to="api.item",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="item_stocks",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "item_pond_stock",
                "unique_together": {("pond", "item")},
            },
        ),
        migrations.AddIndex(
            model_name="itempondstock",
            index=models.Index(fields=["company", "item"], name="api_itempon_company_2f8b2d_idx"),
        ),
    ]
