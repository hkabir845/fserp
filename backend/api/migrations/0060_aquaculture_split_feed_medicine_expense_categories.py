# Split aquaculture expense category feed_medicine into feed_purchase + medicine_purchase;
# retag legacy rows as feed_purchase; rename COA 6716 and add 6721 for medicine.

from decimal import Decimal

from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    AquacultureExpense = apps.get_model("api", "AquacultureExpense")
    AquacultureExpense.objects.filter(expense_category="feed_medicine").update(expense_category="feed_purchase")

    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    Company = apps.get_model("api", "Company")
    today = timezone.now().date()

    ChartOfAccount.objects.filter(account_code="6716").update(
        account_name="Aquaculture Expense — Feed",
        description="Commercial feed purchases (feed_purchase).",
    )

    for cid in Company.objects.filter(is_deleted=False, aquaculture_enabled=True).values_list("id", flat=True):
        if ChartOfAccount.objects.filter(company_id=cid, account_code="6721").exists():
            continue
        ChartOfAccount.objects.create(
            company_id=cid,
            account_code="6721",
            account_name="Aquaculture Expense — Medicine & Veterinary",
            account_type="expense",
            account_sub_type="supplies_materials",
            description="Medicine, vaccine, and veterinary supplies (medicine_purchase).",
            parent_id=None,
            opening_balance=Decimal("0"),
            opening_balance_date=today,
            is_active=True,
        )


def backwards(apps, schema_editor):
    """Cannot merge medicine_purchase back into feed_medicine without data loss; COA 6721 left in place."""
    AquacultureExpense = apps.get_model("api", "AquacultureExpense")
    AquacultureExpense.objects.filter(expense_category="feed_purchase").update(expense_category="feed_medicine")

    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    ChartOfAccount.objects.filter(account_code="6716").update(
        account_name="Aquaculture Expense — Feed & Medicine",
        description="Feed and veterinary / medicine purchases (feed_medicine).",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0059_aquaculture_pond_lease_fields"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
