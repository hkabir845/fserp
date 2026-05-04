from django.db import migrations, models
from django.db.models import Q


def backfill_item_category(apps, schema_editor):
    Item = apps.get_model("api", "Item")
    Item.objects.filter(Q(category__isnull=True) | Q(category="")).update(
        category="General"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0041_user_pos_sale_scope"),
    ]

    operations = [
        migrations.RunPython(backfill_item_category, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="item",
            name="category",
            field=models.CharField(
                default="General",
                max_length=100,
                help_text="Reporting / merchandising category (for item and category sales reports).",
            ),
        ),
    ]
