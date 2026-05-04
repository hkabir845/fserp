from django.db import migrations


def fix_loan_counterparty_bank_defaults(apps, schema_editor):
    """
    The loans UI used to default new counterparties to role_type='bank', so many
    non-bank parties were stored as bank and got annual (/365) interest treatment.

    - If the row is linked to employee / vendor / customer, set role to match
      (monthly-style /360 for those party types).
    - Remaining role_type='bank' rows become 'other' (monthly /360). Genuine
      banks or finance companies without those links must be edited back to
      Bank or Finance company under Loans → Counterparties.
    """
    LoanCounterparty = apps.get_model("api", "LoanCounterparty")
    LoanCounterparty.objects.filter(role_type="bank", employee_id__isnull=False).update(
        role_type="employee"
    )
    LoanCounterparty.objects.filter(role_type="bank", vendor_id__isnull=False).update(
        role_type="vendor"
    )
    LoanCounterparty.objects.filter(role_type="bank", customer_id__isnull=False).update(
        role_type="customer"
    )
    LoanCounterparty.objects.filter(role_type="bank").update(role_type="other")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0019_loan_repayment_reversal"),
    ]

    operations = [
        migrations.RunPython(fix_loan_counterparty_bank_defaults, noop_reverse),
    ]
