# Two-lane mill bills: credit at MRP vs cash-only net; actual lorry fare; credit-note kinds.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0190_vendor_rate_card_transport_percent"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="actual_lorry_fare",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="What we paid the driver. Extra over mill share is our transport cost.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="bill",
            name="mill_settlement",
            field=models.CharField(
                blank=True,
                default="",
                help_text="credit = payable at MRP (terms wait for mill credit notes); cash = discount+lorry taken now.",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="vendorcredit",
            name="bill",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, this mill credit note applies to that bill's open balance.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="mill_credits",
                to="api.bill",
            ),
        ),
        migrations.AlterField(
            model_name="vendorcredit",
            name="credit_kind",
            field=models.CharField(
                choices=[
                    ("monthly", "Monthly scheme"),
                    ("yearly", "Yearly scheme"),
                    ("manual", "Manual mill credit"),
                    ("discount", "Discount"),
                    ("transport", "Lorry / transport"),
                ],
                default="manual",
                max_length=16,
            ),
        ),
    ]
