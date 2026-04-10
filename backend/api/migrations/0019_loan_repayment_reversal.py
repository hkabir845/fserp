import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0018_loan_interest_accrual_islamic_variant"),
    ]

    operations = [
        migrations.AddField(
            model_name="loanrepayment",
            name="reversed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrepayment",
            name="reversal_journal_entry",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loan_repayment_reversals",
                to="api.journalentry",
            ),
        ),
    ]
