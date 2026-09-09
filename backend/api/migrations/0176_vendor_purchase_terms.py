# Vendor supplier category, mill credit facility, rate cards, scheme credits, bill MRP terms, item MRP.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0175_pond_warehouse_transfer_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="mrp",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="List / maximum retail price per unit (feed and medicine mill invoices). 0 means unset.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="supplier_category",
            field=models.CharField(
                db_index=True,
                default="general",
                help_text="What this party mainly supplies. Feed/medicine unlock mill credit and purchase terms.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="credit_facility_enabled",
            field=models.BooleanField(
                default=False,
                help_text="When true and credit_limit > 0, posted bills cannot exceed available credit unless cash covers the shortfall.",
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="credit_limit",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Promised dealer credit ceiling (user-entered; not a system default).",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="credit_start_date",
            field=models.DateField(
                blank=True,
                help_text="Date this credit year started; square-off is the same date next year unless overridden.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="square_off_date",
            field=models.DateField(
                blank=True,
                help_text="By this date remaining credit must be paid to zero. Blank = anniversary of credit_start_date.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="require_zero_on_square_off",
            field=models.BooleanField(
                default=True,
                help_text="After square-off date, new purchases are cash-only until the balance is zero.",
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="mrp",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Unit MRP when the mill invoices on list price. 0 = not used (qty × unit_price is the amount).",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="instant_discount_amount",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Instant trade discount deducted from qty × MRP on this line.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="billline",
            name="transport_amount",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Supplier transport deducted from this line (reduces net payable).",
                max_digits=14,
            ),
        ),
        migrations.CreateModel(
            name="VendorRateCard",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("effective_from", models.DateField()),
                ("effective_to", models.DateField(blank=True, null=True)),
                ("instant_discount_percent", models.DecimalField(decimal_places=4, default=0, max_digits=8)),
                ("instant_discount_per_unit", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("transport_per_unit", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("transport_per_kg", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("monthly_rebate_percent", models.DecimalField(decimal_places=4, default=0, max_digits=8)),
                ("yearly_rebate_percent", models.DecimalField(decimal_places=4, default=0, max_digits=8)),
                ("yearly_target_kg", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vendor_rate_cards",
                        to="api.company",
                    ),
                ),
                (
                    "vendor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="rate_cards",
                        to="api.vendor",
                    ),
                ),
            ],
            options={
                "db_table": "vendor_rate_card",
                "ordering": ["-effective_from", "-id"],
            },
        ),
        migrations.CreateModel(
            name="VendorCredit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("credit_date", models.DateField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=14)),
                (
                    "credit_kind",
                    models.CharField(
                        choices=[
                            ("monthly", "Monthly scheme"),
                            ("yearly", "Yearly scheme"),
                            ("manual", "Manual mill credit"),
                        ],
                        default="manual",
                        max_length=16,
                    ),
                ),
                ("period_label", models.CharField(blank=True, default="", max_length=32)),
                ("mrp_base_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("percent_applied", models.DecimalField(decimal_places=4, default=0, max_digits=8)),
                ("memo", models.CharField(blank=True, default="", max_length=500)),
                ("vendor_ap_decremented", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vendor_credits",
                        to="api.company",
                    ),
                ),
                (
                    "journal",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="vendor_scheme_credits",
                        to="api.journalentry",
                    ),
                ),
                (
                    "vendor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scheme_credits",
                        to="api.vendor",
                    ),
                ),
            ],
            options={
                "db_table": "vendor_credit",
                "ordering": ["-credit_date", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="vendorratecard",
            index=models.Index(fields=["vendor", "effective_from"], name="vendor_rate_vendor__eff_idx"),
        ),
    ]
