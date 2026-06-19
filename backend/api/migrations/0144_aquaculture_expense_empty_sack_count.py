from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0143_seed_cross_entity_expense_categories"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquacultureexpense",
            name="empty_sack_count",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Empty feed sacks auto-created at the pond when feed sacks were opened (feed_consumed).",
                max_digits=12,
                null=True,
            ),
        ),
    ]
