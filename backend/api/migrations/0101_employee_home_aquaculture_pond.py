from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0100_bill_line_receipt_station"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="home_aquaculture_pond",
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    "Primary pond for pond-based labor: payroll and aquaculture P&L attribute "
                    "this employee's wages to this profit center."
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="employees_home",
                to="api.aquaculturepond",
            ),
        ),
    ]
