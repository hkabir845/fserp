"""Store POS cash received and customer change on the invoice.

These are receipt fields. The posted sale total and cash journal stay at invoice.total;
change given back is not extra revenue.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0200_aqua_ops_index_rename"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="pos_amount_tendered",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text=(
                    "Amount the customer handed over at POS (cash received). Receipt only: "
                    "the posted sale and cash journal stay at total."
                ),
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="invoice",
            name="pos_change_due",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Change returned to the customer (POS amount minus invoice total).",
                max_digits=14,
                null=True,
            ),
        ),
        migrations.AddConstraint(
            model_name="invoice",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(pos_amount_tendered__isnull=True)
                    | models.Q(pos_amount_tendered__gte=0)
                )
                & (models.Q(pos_change_due__isnull=True) | models.Q(pos_change_due__gte=0)),
                name="invoice_pos_tender_nonneg",
            ),
        ),
    ]
