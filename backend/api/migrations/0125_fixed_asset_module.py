"""Fixed asset module tables and default depreciation expense COA (6320)."""

from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models
from django.utils import timezone


FA_DEFAULT_COA = (
    (
        "6320",
        "Depreciation Expense — Buildings & Equipment",
        "expense",
        "other_business_expenses",
        "Periodic depreciation on fixed assets (Dr on AUTO-FA-DEP journals).",
    ),
)


def seed_fa_coa(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    ChartOfAccount = apps.get_model("api", "ChartOfAccount")
    today = timezone.now().date()
    for co in Company.objects.filter(is_deleted=False):
        existing = set(
            ChartOfAccount.objects.filter(company_id=co.id).values_list("account_code", flat=True)
        )
        for code, name, atype, stype, desc in FA_DEFAULT_COA:
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


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0124_pondclose_settlement_snapshot"),
    ]

    operations = [
        migrations.CreateModel(
            name="FixedAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("asset_number", models.CharField(max_length=64)),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("status", models.CharField(default="draft", max_length=24)),
                ("acquisition_date", models.DateField(blank=True, null=True)),
                ("in_service_date", models.DateField(blank=True, null=True)),
                ("disposal_date", models.DateField(blank=True, null=True)),
                ("acquisition_cost", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("salvage_value", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("useful_life_months", models.PositiveSmallIntegerField(default=60)),
                ("depreciation_method", models.CharField(default="straight_line", max_length=24)),
                (
                    "opening_accumulated_depreciation",
                    models.DecimalField(decimal_places=2, default=0, max_digits=14),
                ),
                ("accumulated_depreciation", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("last_depreciation_date", models.DateField(blank=True, null=True)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "accumulated_depreciation_account",
                    models.ForeignKey(
                        help_text="Contra-asset accumulated depreciation (e.g. 1550).",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="fixed_assets_accum_depr",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "acquisition_journal_entry",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_asset_acquisitions",
                        to="api.journalentry",
                    ),
                ),
                (
                    "aquaculture_pond",
                    models.ForeignKey(
                        blank=True,
                        help_text="Pond entity for depreciation expense when asset belongs to aquaculture.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_assets",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "asset_account",
                    models.ForeignKey(
                        help_text="Fixed-asset GL line (e.g. 1510–1540).",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="fixed_assets_asset",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="fixed_assets",
                        to="api.company",
                    ),
                ),
                (
                    "depreciation_expense_account",
                    models.ForeignKey(
                        help_text="Depreciation expense P&L line (e.g. 6320).",
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="fixed_assets_depr_expense",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "disposal_journal_entry",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_asset_disposals",
                        to="api.journalentry",
                    ),
                ),
                (
                    "settlement_account",
                    models.ForeignKey(
                        blank=True,
                        help_text="Bank/cash line for acquisition posting when capitalizing a new purchase.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_assets_settlement",
                        to="api.chartofaccount",
                    ),
                ),
                (
                    "station",
                    models.ForeignKey(
                        blank=True,
                        help_text="Site for depreciation expense tagging (P&L / segment reporting).",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_assets",
                        to="api.station",
                    ),
                ),
            ],
            options={
                "db_table": "fixed_asset",
                "ordering": ["-created_at", "-id"],
                "unique_together": {("company", "asset_number")},
            },
        ),
        migrations.CreateModel(
            name="FixedAssetDepreciationRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("run_date", models.DateField()),
                ("period_start", models.DateField(blank=True, null=True)),
                ("period_end", models.DateField(blank=True, null=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "fixed_asset",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="depreciation_runs",
                        to="api.fixedasset",
                    ),
                ),
                (
                    "journal_entry",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fixed_asset_depreciation_runs",
                        to="api.journalentry",
                    ),
                ),
            ],
            options={
                "db_table": "fixed_asset_depreciation_run",
                "ordering": ["-run_date", "-id"],
            },
        ),
        migrations.RunPython(seed_fa_coa, migrations.RunPython.noop),
    ]
