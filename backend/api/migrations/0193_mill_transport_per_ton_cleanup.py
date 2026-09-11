# Mill transport is ৳/ton, not fixed per lorry. Move leftover truck rates onto per-ton.

from decimal import Decimal

from django.db import migrations
from django.db.models import F, Q


def forwards(apps, schema_editor):
    VendorRateCard = apps.get_model("api", "VendorRateCard")
    zero = Decimal("0")
    # Prefer per-ton: if truck was the old “950” and per-ton empty, copy it.
    VendorRateCard.objects.filter(
        Q(transport_per_ton__isnull=True) | Q(transport_per_ton=zero),
        transport_per_truck__gt=zero,
    ).update(transport_per_ton=F("transport_per_truck"), transport_per_truck=zero)
    # If both were set (common after dual fields), drop fixed truck — per-ton wins.
    VendorRateCard.objects.filter(transport_per_ton__gt=zero, transport_per_truck__gt=zero).update(
        transport_per_truck=zero
    )


def backwards(apps, schema_editor):
    # Non-destructive reverse: leave rates as-is.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0192_vendor_rate_card_transport_per_ton"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
