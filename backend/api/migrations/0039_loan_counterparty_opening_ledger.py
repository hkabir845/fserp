# Generated for loan counterparty opening balance + party_kind

import django.db.models.deletion
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0038_company_role_and_user_custom_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="loancounterparty",
            name="party_kind",
            field=models.CharField(
                default="other",
                help_text="customer, supplier, lender, borrower, both, other (business context for the party)",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_balance_type",
            field=models.CharField(
                default="zero",
                help_text="receivable | payable | zero (opening loan with no history in this system)",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_balance",
            field=models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=14),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_balance_as_of",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_interest_applicable",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_annual_interest_rate",
            field=models.DecimalField(
                blank=True,
                decimal_places=4,
                help_text="Indicative annual % on opening; accrual uses loan facilities once booked.",
                max_digits=8,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_principal_account",
            field=models.ForeignKey(
                blank=True,
                help_text="GL used in opening entry (receivable 1160- or payable 2410-style line).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loan_counterparties_opening_principal",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_equity_account",
            field=models.ForeignKey(
                blank=True,
                help_text="If set, use instead of default 3200 Opening Balance Equity for the Cr/Dr on opening.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loan_counterparties_opening_equity",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="loancounterparty",
            name="opening_balance_journal",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loan_counterparty_openings",
                to="api.journalentry",
            ),
        ),
    ]
