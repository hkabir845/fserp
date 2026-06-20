from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0150_remove_aquaculture_equipment_maintenance_coa"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquacultureproductioncycle",
            name="fish_species",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="tilapia",
                help_text="Primary species in this stocking batch (e.g. tilapia fry cohort).",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="aquacultureproductioncycle",
            name="fish_species_other",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="aquacultureproductioncycle",
            name="source_production_cycle",
            field=models.ForeignKey(
                blank=True,
                help_text="Nursing batch this grow-out batch was stocked from (fingerling transfer).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="derived_production_cycles",
                to="api.aquacultureproductioncycle",
            ),
        ),
    ]
