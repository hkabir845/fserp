from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0113_company_aquaculture_go_live_cutover"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-CUST-OB-{customer id} when opening balance is posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="customer_openings",
                to="api.journalentry",
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-VEND-OB-{vendor id} when opening balance is posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vendor_openings",
                to="api.journalentry",
            ),
        ),
    ]
