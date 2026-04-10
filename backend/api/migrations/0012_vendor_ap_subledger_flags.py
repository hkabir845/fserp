# Vendor A/P subledger flags + backfill from existing auto journals.

from django.db import migrations, models


def forwards_backfill_flags(apps, schema_editor):
    Bill = apps.get_model("api", "Bill")
    Payment = apps.get_model("api", "Payment")
    JournalEntry = apps.get_model("api", "JournalEntry")

    for b in Bill.objects.all().only("id", "company_id"):
        en = f"AUTO-BILL-{b.id}"
        if JournalEntry.objects.filter(company_id=b.company_id, entry_number=en).exists():
            Bill.objects.filter(pk=b.pk).update(vendor_ap_incremented=True)

    for p in Payment.objects.filter(payment_type="made").only("id", "company_id"):
        en = f"AUTO-PAY-{p.id}-MADE"
        if JournalEntry.objects.filter(company_id=p.company_id, entry_number=en).exists():
            Payment.objects.filter(pk=p.pk).update(vendor_ap_decremented=True)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_bill_stock_receipt_and_line_tank"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="vendor_ap_incremented",
            field=models.BooleanField(
                default=False,
                help_text="True once this bill's total was added to vendor.current_balance (A/P subledger).",
            ),
        ),
        migrations.AddField(
            model_name="payment",
            name="vendor_ap_decremented",
            field=models.BooleanField(
                default=False,
                help_text="For payments made: True once amount was subtracted from vendor.current_balance.",
            ),
        ),
        migrations.RunPython(forwards_backfill_flags, migrations.RunPython.noop),
    ]
