# Per-truck transport, bill header truck amount, monthly scheme reserve (not A/P).

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0176_vendor_purchase_terms"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendorratecard",
            name="transport_per_truck",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Transport deducted once per bill/truck. 0 = this mill does not use per-truck transport.",
                max_digits=14,
            ),
        ),
        migrations.AddField(
            model_name="bill",
            name="truck_transport_amount",
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text="Per-bill/truck transport deducted from mill MRP bills. 0 = not used on this bill.",
                max_digits=14,
            ),
        ),
        migrations.CreateModel(
            name="VendorSchemeReserve",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("credit_kind", models.CharField(choices=[("monthly", "Monthly scheme reserve")], default="monthly", max_length=16)),
                ("period_label", models.CharField(max_length=32)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("mrp_base_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("percent_applied", models.DecimalField(decimal_places=4, default=0, max_digits=8)),
                ("as_of", models.DateField()),
                ("memo", models.CharField(blank=True, default="", max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="vendor_scheme_reserves",
                        to="api.company",
                    ),
                ),
                (
                    "vendor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="scheme_reserves",
                        to="api.vendor",
                    ),
                ),
            ],
            options={
                "db_table": "vendor_scheme_reserve",
                "ordering": ["-period_label", "-id"],
            },
        ),
        migrations.AddConstraint(
            model_name="vendorschemereserve",
            constraint=models.UniqueConstraint(
                fields=("company", "vendor", "credit_kind", "period_label"),
                name="uniq_vendor_scheme_reserve_period",
            ),
        ),
    ]
