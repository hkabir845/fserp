from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0101_employee_home_aquaculture_pond"),
    ]

    operations = [
        migrations.AddField(
            model_name="employee",
            name="aquaculture_labor_scope",
            field=models.CharField(
                choices=[
                    ("assigned_pond", "Single pond"),
                    ("all_ponds_equal", "Shared equally across all ponds"),
                ],
                db_index=True,
                default="assigned_pond",
                help_text=(
                    "assigned_pond: wages go to home pond (or site default). "
                    "all_ponds_equal: managers / shared staff — salary split evenly on every active pond."
                ),
                max_length=32,
            ),
        ),
    ]
