"""Reversal fields on fixed asset depreciation runs."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0125_fixed_asset_module"),
    ]

    operations = [
        migrations.AddField(
            model_name="fixedassetdepreciationrun",
            name="reversed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="fixedassetdepreciationrun",
            name="reversal_journal_entry",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="fixed_asset_depreciation_reversals",
                to="api.journalentry",
            ),
        ),
    ]
