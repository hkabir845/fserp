# Give every existing pond its selling identity (internal vendor) and flag the
# auto-provisioned POS customer as an internal party, so pond-to-pond trade can be
# separated from real customers and suppliers in A/R and A/P reporting.

import logging

from django.db import migrations

logger = logging.getLogger(__name__)


def backfill_pond_internal_vendors(apps, schema_editor):
    # Live models are safe here: this migration is the current head, so every field
    # referenced by the service already exists as a DB column.
    from api.models import AquaculturePond
    from api.services.aquaculture_pond_internal_vendor import (
        provision_pond_internal_parties,
    )

    for pond in AquaculturePond.objects.order_by("id").iterator(chunk_size=100):
        try:
            err = provision_pond_internal_parties(
                company_id=pond.company_id, pond=pond
            )
            if err:
                logger.warning(
                    "backfill pond internal vendor: pond=%s company=%s: %s",
                    pond.pk,
                    pond.company_id,
                    err,
                )
        except Exception:
            logger.exception(
                "backfill pond internal vendor failed pond=%s company=%s",
                pond.pk,
                pond.company_id,
            )


def noop_reverse(apps, schema_editor):
    """Leave the vendors in place; unlinking them would orphan any bills raised against them."""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0167_internal_trading_parties"),
    ]

    operations = [
        migrations.RunPython(backfill_pond_internal_vendors, noop_reverse),
    ]
