from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0048_company_time_zone"),
    ]

    operations = [
        migrations.AddField(
            model_name="journalentry",
            name="station",
            field=models.ForeignKey(
                blank=True,
                help_text="Site dimension for reporting; not required for balanced double-entry.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_entries",
                to="api.station",
            ),
        ),
    ]
