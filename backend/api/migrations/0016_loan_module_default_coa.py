"""Add built-in chart lines for the Loans module to every existing company (idempotent per company)."""

from decimal import Decimal

from django.db import migrations
from django.utils import timezone


LOAN_DEFAULT_ROWS = (
    (
        "1160",
        "Loans Receivable — Principal (Money Lent)",
        "loan",
        "loan_receivable",
        "Balance-sheet principal for funds you lent to others. Use as Principal GL on Loans → Lent.",
    ),
    (
        "2410",
        "Loans Payable — Principal (Borrowed Funds)",
        "loan",
        "loan_payable",
        "Balance-sheet principal for bank and third-party loans you owe. Use as Principal GL on Loans → Borrowed.",
    ),
    (
        "4410",
        "Interest Income — Loans Receivable",
        "income",
        "other_income",
        "Interest earned on lent funds. Optional Interest GL when splitting repayments on Lent loans.",
    ),
    (
        "6620",
        "Interest Expense — Loan Borrowings",
        "expense",
        "other_business_expenses",
        "Interest paid on borrowed funds. Optional Interest GL when splitting repayments on Borrowed loans.",
    ),
)


def forwards(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    today = timezone.now().date()
    for co in Company.objects.filter(is_deleted=False):
        existing = set(
            ChartOfAccount.objects.filter(company_id=co.id).values_list("account_code", flat=True)
        )
        for code, name, atype, stype, desc in LOAN_DEFAULT_ROWS:
            if code in existing:
                continue
            ChartOfAccount.objects.create(
                company_id=co.id,
                account_code=code,
                account_name=name,
                account_type=atype,
                account_sub_type=stype,
                description=desc,
                parent_id=None,
                opening_balance=Decimal("0"),
                opening_balance_date=today,
                is_active=True,
            )
            existing.add(code)


def backwards(apps, schema_editor):
    # Do not remove COA rows: they may already have journal activity (CASCADE would destroy history).
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0015_payroll_run"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
