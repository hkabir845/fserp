import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0108_data_bank_pond_close_api_user_ids"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturelandlord",
            name="opening_balance",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Subledger opening: positive = rent owed to landlord; negative = credit or prepaid.",
                max_digits=18,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlord",
            name="opening_balance_date",
            field=models.DateField(
                blank=True,
                help_text="As-of date for the opening balance adjustment in the landlord ledger.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlord",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-LL-OB-{landlord id} when opening balance is posted to the G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_landlord_openings",
                to="api.journalentry",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlord",
            name="opening_balance_ledger_entry",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO adjustment row created from opening_balance (reference OPENING).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="landlord_opening_for",
                to="api.aquaculturelandlordledgerentry",
            ),
        ),
    ]
