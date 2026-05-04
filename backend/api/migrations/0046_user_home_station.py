import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0045_company_station_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="home_station",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="users_assigned_home",
                to="api.station",
            ),
        ),
    ]
