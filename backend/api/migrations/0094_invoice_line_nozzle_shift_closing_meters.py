import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0093_payrollrun_subledger_employee"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoiceline",
            name="nozzle",
            field=models.ForeignKey(
                blank=True,
                help_text="Forecourt nozzle used for this fuel sale line (POS attribution).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invoice_lines",
                to="api.nozzle",
            ),
        ),
        migrations.AddField(
            model_name="shiftsession",
            name="closing_meters",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Snapshot at close: [{ meter_id, reading, previous_reading, meter_name, dispenser_name }, ...]",
            ),
        ),
    ]
