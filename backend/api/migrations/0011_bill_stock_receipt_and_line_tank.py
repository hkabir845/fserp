# Generated manually for bill inventory receipt idempotency and per-line tank.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0010_payment_payment_method"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="stock_receipt_applied",
            field=models.BooleanField(
                default=False,
                help_text="Set when inventory receipt from this bill has been applied (tank + QOH).",
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="tank",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, fuel/inventory receipt posts into this tank (must match line item).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bill_lines",
                to="api.tank",
            ),
        ),
    ]
