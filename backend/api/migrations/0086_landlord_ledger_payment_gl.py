# Generated manually for landlord payment G/L linkage.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0085_aquaculture_landlords"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturelandlordledgerentry",
            name="bank_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set on a payment, posts Dr aquaculture lease expense (6711) / Cr this register's G/L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_landlord_ledger_entries",
                to="api.bankaccount",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlordledgerentry",
            name="journal_entry",
            field=models.ForeignKey(
                blank=True,
                help_text="AUTO-LL-PAY-{this row id} when bank_account is set and G/L posted.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_landlord_ledger_entries",
                to="api.journalentry",
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlordledgerentry",
            name="payment_method",
            field=models.CharField(
                blank=True,
                default="cash",
                help_text="Mirrors Payment.payment_method for resolving cash vs bank G/L credit line.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="aquaculturelandlordledgerentry",
            name="station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional site dimension on the auto journal (e.g. Premium Agro hub paying lease).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="aquaculture_landlord_ledger_entries",
                to="api.station",
            ),
        ),
    ]
