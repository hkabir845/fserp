import django.db.models.deletion
from django.db import migrations, models


def seed_bio_coa(apps, schema_editor):
    from api.services.aquaculture_coa_seed import seed_aquaculture_coa_for_all_enabled_companies

    seed_aquaculture_coa_for_all_enabled_companies()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0068_aquaculture_fish_pond_transfer"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturebiomasssample",
            name="production_cycle",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="biomass_samples",
                to="api.aquacultureproductioncycle",
            ),
        ),
        migrations.CreateModel(
            name="AquacultureFishStockLedger",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("entry_date", models.DateField(db_index=True)),
                (
                    "entry_kind",
                    models.CharField(
                        db_index=True,
                        help_text="loss | adjustment — loss reasons are required for loss; adjustment allows signed count/weight.",
                        max_length=20,
                    ),
                ),
                ("loss_reason", models.CharField(blank=True, db_index=True, max_length=32)),
                ("fish_species", models.CharField(db_index=True, default="tilapia", max_length=64)),
                ("fish_species_other", models.CharField(blank=True, max_length=120)),
                ("fish_count_delta", models.IntegerField(default=0)),
                ("weight_kg_delta", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                (
                    "book_value",
                    models.DecimalField(
                        decimal_places=2,
                        default=0,
                        help_text="Optional currency amount for GL posting (positive).",
                        max_digits=14,
                    ),
                ),
                ("post_to_books", models.BooleanField(default=False)),
                ("memo", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="aquaculture_fish_stock_ledger",
                        to="api.company",
                    ),
                ),
                (
                    "journal_entry",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="aquaculture_fish_stock_ledger",
                        to="api.journalentry",
                    ),
                ),
                (
                    "pond",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="fish_stock_ledger_entries",
                        to="api.aquaculturepond",
                    ),
                ),
                (
                    "production_cycle",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="fish_stock_ledger_entries",
                        to="api.aquacultureproductioncycle",
                    ),
                ),
            ],
            options={
                "db_table": "aquaculture_fish_stock_ledger",
                "ordering": ["-entry_date", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="aquaculturefishstockledger",
            index=models.Index(
                fields=["company", "pond", "entry_date"],
                name="aquaculture_fishstk_co_pond_dt",
            ),
        ),
        migrations.RunPython(seed_bio_coa, migrations.RunPython.noop),
    ]
