# Generated manually for segment reporting and data hygiene.

from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


def backfill_null_invoice_stations(apps, schema_editor):
    Invoice = apps.get_model("api", "Invoice")
    Customer = apps.get_model("api", "Customer")
    Station = apps.get_model("api", "Station")
    qs = (
        Invoice.objects.filter(Q(station_id__isnull=True) | Q(station_id=0))
        .select_related("customer")
        .iterator(chunk_size=500)
    )
    for inv in qs:
        company_id = inv.company_id
        active = list(
            Station.objects.filter(company_id=company_id, is_active=True).values_list(
                "id", flat=True
            )
        )
        if not active:
            continue
        default_sid = min(active)
        target = default_sid
        c = inv.customer
        if c and getattr(c, "default_station_id", None):
            ds = int(c.default_station_id)
            if ds in active:
                target = ds
        Invoice.objects.filter(pk=inv.pk, company_id=company_id).update(station_id=target)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0051_sync_model_help_text"),
    ]

    operations = [
        migrations.AddField(
            model_name="loan",
            name="station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional site for GL tagging on disbursements, repayments, and accruals (management / segment reporting; cash still settles through the chosen bank account).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loans",
                to="api.station",
            ),
        ),
        migrations.RunPython(backfill_null_invoice_stations, noop_reverse),
    ]
