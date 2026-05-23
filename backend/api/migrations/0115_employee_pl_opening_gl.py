from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0114_customer_vendor_opening_gl"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="pl_opening_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-POND-PL-OB-{pond id} when prior P&L openings are posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_pond_pl_openings",
                to="api.journalentry",
            ),
        ),
        migrations.AddField(
            model_name="employee",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-EMP-OB-{employee id} when opening balance is posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="employee_openings",
                to="api.journalentry",
            ),
        ),
    ]
