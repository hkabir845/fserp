from django.db import migrations, models


def backfill_active_pos_line_evidence(apps, schema_editor):
    InvoiceLine = apps.get_model("api", "InvoiceLine")
    rows = InvoiceLine.objects.filter(
        invoice__stock_relieved=True,
        invoice__invoice_number__istartswith="INV-POS-",
        invoice__status__in=("sent", "paid", "overdue"),
        item__item_type="inventory",
        nozzle_id__isnull=True,
        quantity__gt=0,
    ).select_related("invoice")
    for line in rows.iterator():
        line.stock_relieved_quantity = line.quantity
        line.stock_relieved_station_id = line.invoice.station_id
        line.save(update_fields=["stock_relieved_quantity", "stock_relieved_station_id"])


class Migration(migrations.Migration):
    dependencies = [("api", "0178_invoice_stock_relieved")]

    operations = [
        migrations.AddField(
            model_name="invoiceline",
            name="stock_relieved_quantity",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Exact physical quantity relieved when this line was posted; reversal evidence.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="stock_relieved_station_id",
            field=models.IntegerField(
                blank=True,
                help_text="Station bin used for the recorded stock relief, retained for exact reversal.",
                null=True,
            ),
        ),
        migrations.RunPython(backfill_active_pos_line_evidence, migrations.RunPython.noop),
    ]
