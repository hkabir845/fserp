# Generated manually for per-line invoice entity + reporting tags.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0147_drop_orphan_item_brand"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoiceline",
            name="receipt_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional per-line selling site for revenue/COGS entity P&L (overrides invoice header).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invoice_lines_receipt",
                to="api.station",
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, revenue/COGS from this line are tagged for aquaculture pond P&L.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invoice_lines",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="fuel_station_income_category",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Fuel-station income rollup or tenant category code (station P&L on invoices).",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="aquaculture_income_category",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Aquaculture income type or tenant category code (pond P&L on invoices).",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="tenant_reporting_category",
            field=models.ForeignKey(
                blank=True,
                help_text="Resolved tenant reporting row for custom income/expense sub-tags.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invoice_lines",
                to="api.tenantreportingcategory",
            ),
        ),
    ]
