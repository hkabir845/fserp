from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0009_bankaccount_is_equity_register"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="payment_method",
            field=models.CharField(
                blank=True,
                default="",
                help_text="check, ach, cash, etc. (payments made/received UI)",
                max_length=32,
            ),
        ),
    ]
