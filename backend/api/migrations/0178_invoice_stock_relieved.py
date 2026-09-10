"""Record on the invoice whether it has already moved physical stock.

``Bill.stock_receipt_applied`` has always done this for purchases. Sales had no equivalent, so
the rollback path had to guess from the invoice number prefix (``INV-POS-``) whether stock had
moved — which is why invoices raised outside the POS relieved inventory in the ledger but never
touched quantity on hand.

Existing POS invoices are backfilled to ``True`` so their rollback keeps restoring stock exactly
as it does today. Everything else stays ``False``: those invoices genuinely never moved stock,
and marking them relieved would put quantity back that was never taken.

(The ``RenameIndex`` is unrelated pre-existing drift from the vendor rate-card migration; it is
carried here so ``makemigrations --check`` is clean.)
"""

from django.db import migrations, models


def backfill_pos_invoices_as_relieved(apps, schema_editor):
    Invoice = apps.get_model("api", "Invoice")
    Invoice.objects.filter(invoice_number__istartswith="INV-POS-").exclude(
        status__iexact="void"
    ).update(stock_relieved=True)


def unset_stock_relieved(apps, schema_editor):
    Invoice = apps.get_model("api", "Invoice")
    Invoice.objects.update(stock_relieved=False)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0177_journal_entry_number_unique_and_indexes"),
    ]

    operations = [
        migrations.RenameIndex(
            model_name="vendorratecard",
            new_name="vendor_rate_vendor__68aba3_idx",
            old_name="vendor_rate_vendor__eff_idx",
        ),
        migrations.AddField(
            model_name="invoice",
            name="stock_relieved",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "True once this invoice has decremented physical stock. Mirror of "
                    "Bill.stock_receipt_applied: relief happens exactly once and is unwound "
                    "exactly once when the invoice is edited, voided or deleted."
                ),
            ),
        ),
        migrations.RunPython(backfill_pos_invoices_as_relieved, unset_stock_relieved),
    ]
