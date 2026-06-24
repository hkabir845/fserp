"""Recompute biomass sample book/extrapolation snapshots (includes inactive ponds)."""

from __future__ import annotations

from django.db import migrations


def _noop(apps, schema_editor):
    # Backfill moved to 0154 — live services need schema from 0137+ and 0153.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0134_loan_counterparty_opening_station"),
    ]

    operations = [
        migrations.RunPython(_noop, migrations.RunPython.noop),
    ]
