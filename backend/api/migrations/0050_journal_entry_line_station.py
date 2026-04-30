import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0049_journal_entry_station"),
    ]

    operations = [
        migrations.AddField(
            model_name="journalentryline",
            name="station",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_lines",
                to="api.station",
                help_text="Selling or register site for this line; enables site-scoped P&L and trial balance.",
            ),
        ),
    ]
