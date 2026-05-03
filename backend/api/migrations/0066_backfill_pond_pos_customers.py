# Backfill General POS customers for aquaculture ponds that never received one
# (e.g. created before auto-provisioning). Ensures /customers and Cashier list them.

import logging

from django.db import migrations

logger = logging.getLogger(__name__)


def backfill_pond_pos_customers(apps, schema_editor):
    # Use historical model: live AquaculturePond includes fields from later migrations
    # (e.g. pond_role in 0068) that are not DB columns yet at this step.
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    from api.services.aquaculture_pond_pos_customer import maybe_provision_auto_pos_customer

    qs = AquaculturePond.objects.filter(pos_customer_id__isnull=True).order_by("id")
    for pond in qs.iterator(chunk_size=100):
        try:
            err = maybe_provision_auto_pos_customer(
                company_id=pond.company_id,
                pond=pond,
                skip_auto=False,
            )
            if err:
                logger.warning(
                    "0066_backfill_pond_pos_customers: pond id=%s company=%s: %s",
                    pond.pk,
                    pond.company_id,
                    err,
                )
        except Exception:
            logger.exception(
                "0066_backfill_pond_pos_customers: unexpected error pond id=%s",
                pond.pk,
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0065_aquaculture_pond_auto_pos_customer"),
    ]

    operations = [
        migrations.RunPython(backfill_pond_pos_customers, noop_reverse),
    ]
