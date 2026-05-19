from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0099_pond_pos_customer_shop_station"),
    ]

    operations = [
        migrations.AddField(
            model_name="billline",
            name="receipt_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional per-line station for GL/stock when split across sites or overriding the bill header.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bill_lines_receipt",
                to="api.station",
            ),
        ),
    ]
