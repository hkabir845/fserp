import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0084_pond_warehouse_stock_receipt"),
    ]

    operations = [
        migrations.CreateModel(
            name="AquacultureLandlord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("code", models.CharField(blank=True, max_length=64)),
                ("phone", models.CharField(blank=True, max_length=64)),
                ("email", models.EmailField(blank=True, max_length=254)),
                ("notes", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_landlords",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_landlord",
                "ordering": ["name", "id"],
            },
        ),
        migrations.CreateModel(
            name="AquacultureLandlordPondShare",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "land_area_decimal",
                    models.DecimalField(
                        decimal_places=4,
                        help_text="Portion of leased land (decimals) for this landlord on this pond.",
                        max_digits=14,
                    ),
                ),
                ("notes", models.CharField(blank=True, max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "landlord",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="pond_shares",
                        to="api.aquaculturelandlord",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="landlord_pond_shares",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_landlord_pond_share",
                "unique_together": {("landlord", "pond")},
            },
        ),
        migrations.CreateModel(
            name="AquacultureLandlordLedgerEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entry_date", models.DateField(db_index=True)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("rent_charge", "Rent charge"),
                            ("payment", "Payment"),
                            ("adjustment", "Adjustment"),
                        ],
                        max_length=32,
                    ),
                ),
                (
                    "amount_signed",
                    models.DecimalField(
                        decimal_places=2,
                        help_text="Positive: obligation to landlord increases; negative: payment or credit.",
                        max_digits=18,
                    ),
                ),
                ("memo", models.CharField(blank=True, max_length=500)),
                ("reference", models.CharField(blank=True, max_length=200)),
                (
                    "applies_to_lease_paid",
                    models.BooleanField(
                        default=False,
                        help_text="If true, creating this row increased lease_paid_to_landlord on pond.",
                    ),
                ),
                (
                    "lease_paid_delta",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        help_text="Positive amount added to pond lease_paid_to_landlord when applies_to_lease_paid is true.",
                        max_digits=18,
                        null=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "landlord",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ledger_entries",
                        to="api.aquaculturelandlord",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="landlord_ledger_entries",
                        to="api.aquaculturepond",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_landlord_ledger_entry",
                "ordering": ["entry_date", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturelandlord",
            index=models.Index(fields=["company", "is_active"], name="aquaculture_company_2f7e2d_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturelandlordpondshare",
            index=models.Index(fields=["pond"], name="aquaculture_pond_id_0a8b1c_idx"),
        ),
        migrations.AddIndex(
            model_name="aquaculturelandlordledgerentry",
            index=models.Index(fields=["landlord", "entry_date"], name="aquaculture_landlord_e3f4_idx"),
        ),
    ]
