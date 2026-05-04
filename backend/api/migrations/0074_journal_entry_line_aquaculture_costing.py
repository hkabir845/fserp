from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0073_aquaculture_fish_sale_invoice"),
    ]

    operations = [
        migrations.AddField(
            model_name="journalentryline",
            name="aquaculture_cost_bucket",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Stable cost bucket code (e.g. feed, labor, biological_loss) for reporting joins.",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="journalentryline",
            name="aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional pond dimension for aquaculture auto-journals (costing / traceability).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_lines",
                to="api.aquaculturepond",
            ),
        ),
        migrations.AddField(
            model_name="journalentryline",
            name="aquaculture_production_cycle",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional production cycle when the aquaculture line is cycle-scoped.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_lines",
                to="api.aquacultureproductioncycle",
            ),
        ),
    ]
