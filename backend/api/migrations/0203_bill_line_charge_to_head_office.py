from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0202_inventory_cost_evidence")]
    operations = [migrations.AddField(
        model_name="billline", name="charge_to_head_office",
        field=models.BooleanField(default=False, help_text="Explicit Head Office charge; overrides receipt location and vendor defaults."),
    )]
