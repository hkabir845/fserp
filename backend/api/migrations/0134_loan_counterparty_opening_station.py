from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0133_ensure_same_site_grow_out_per_company"),
    ]

    operations = [
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_balance_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional GL site tag on counterparty opening balance journal lines.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loan_counterparty_openings",
                to="api.station",
            ),
        ),
    ]
