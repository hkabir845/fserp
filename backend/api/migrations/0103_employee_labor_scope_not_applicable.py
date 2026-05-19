from django.db import migrations, models


def fuel_station_staff_to_not_applicable(apps, schema_editor):
    Employee = apps.get_model("api", "Employee")
    Station = apps.get_model("api", "Station")
    fuel_station_ids = set(
        Station.objects.filter(operates_fuel_retail=True).values_list("id", flat=True)
    )
    if not fuel_station_ids:
        return
    Employee.objects.filter(
        home_station_id__in=fuel_station_ids,
        aquaculture_labor_scope="assigned_pond",
        home_aquaculture_pond_id__isnull=True,
    ).update(aquaculture_labor_scope="not_applicable")


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0102_employee_aquaculture_labor_scope"),
    ]

    operations = [
        migrations.AlterField(
            model_name="employee",
            name="aquaculture_labor_scope",
            field=models.CharField(
                choices=[
                    ("not_applicable", "Not applicable (site / company payroll)"),
                    ("assigned_pond", "Single pond"),
                    ("all_ponds_equal", "Shared equally across all ponds"),
                ],
                db_index=True,
                default="not_applicable",
                help_text=(
                    "not_applicable: fuel forecourt, admin, shop staff — wages are not split to pond P&L. "
                    "assigned_pond: field / pond worker — wages to home pond (or shop site default when set). "
                    "all_ponds_equal: shared aquaculture managers — salary split evenly on every active pond."
                ),
                max_length=32,
            ),
        ),
        migrations.RunPython(fuel_station_staff_to_not_applicable, migrations.RunPython.noop),
    ]
