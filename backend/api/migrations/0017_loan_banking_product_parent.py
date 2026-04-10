"""Loan: banking model, product type, Islamic facility parent, deal reference."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0016_loan_module_default_coa"),
    ]

    operations = [
        migrations.AddField(
            model_name="loan",
            name="banking_model",
            field=models.CharField(
                default="conventional",
                help_text="conventional | islamic",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="loan",
            name="product_type",
            field=models.CharField(
                default="general",
                help_text="general, term_loan, business_line, islamic_facility, islamic_deal",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="loan",
            name="deal_reference",
            field=models.CharField(
                blank=True,
                help_text="Islamic deal / temporary reference (e.g. DEAL-000123).",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="loan",
            name="parent_loan",
            field=models.ForeignKey(
                blank=True,
                help_text="Islamic deal rows point to their facility parent.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="child_loans",
                to="api.loan",
            ),
        ),
    ]
