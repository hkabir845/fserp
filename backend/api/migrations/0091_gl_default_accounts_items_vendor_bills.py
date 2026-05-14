# Generated manually for GL posting defaults (items, vendor bills, invoices, payroll).

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0090_aquaculture_pond_depth_lease_price_two_dp"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="revenue_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, invoice/POS revenue for this SKU posts here instead of template 4100/4200.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="items_default_revenue",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="cogs_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, COGS for this SKU uses this account instead of template 5100/5120.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="items_default_cogs",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="inventory_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, inventory receipts/sales for this SKU use this asset account instead of 1200/1220.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="items_default_inventory",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="item",
            name="expense_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, non-inventory vendor bill lines for this SKU debit this expense (else office 6900).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="items_default_expense",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="default_expense_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Default expense/COGS-side debit for bill lines without an item or without line-level override.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vendors_default_expense",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="expense_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional GL debit for this line (non-inventory / description-only); overrides item/vendor defaults.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="bill_lines_expense_override",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="invoiceline",
            name="revenue_account",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional revenue GL for this line; overrides item.revenue_account and template splits.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invoice_lines_revenue_override",
                to="api.chartofaccount",
            ),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="salary_expense_account",
            field=models.ForeignKey(
                blank=True,
                help_text="When set, gross salary debits this expense instead of template 6400.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs_salary_expense",
                to="api.chartofaccount",
            ),
        ),
    ]
