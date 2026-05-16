# Backfill missing pond POS customers and set default_station on aquaculture shop customers.

import logging

from django.db import migrations

logger = logging.getLogger(__name__)


def forward(apps, schema_editor):
    AquaculturePond = apps.get_model("api", "AquaculturePond")
    from api.services.aquaculture_pond_pos_customer import (
        maybe_provision_auto_pos_customer,
        sync_aquaculture_customer_default_stations,
    )

    company_ids = (
        AquaculturePond.objects.filter(pos_customer_id__isnull=True)
        .values_list("company_id", flat=True)
        .distinct()
    )
    for cid in company_ids:
        for pond in AquaculturePond.objects.filter(company_id=cid, pos_customer_id__isnull=True).order_by("id"):
            try:
                err = maybe_provision_auto_pos_customer(company_id=cid, pond=pond, skip_auto=False)
                if err:
                    logger.warning(
                        "0099_pond_pos_customer_shop_station: pond id=%s company=%s: %s",
                        pond.pk,
                        cid,
                        err,
                    )
            except Exception:
                logger.exception(
                    "0099_pond_pos_customer_shop_station: unexpected error pond id=%s",
                    pond.pk,
                )

    all_cids = AquaculturePond.objects.values_list("company_id", flat=True).distinct()
    for cid in all_cids:
        try:
            sync_aquaculture_customer_default_stations(company_id=cid)
        except Exception:
            logger.exception(
                "0099_pond_pos_customer_shop_station: sync stations failed company=%s",
                cid,
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0098_item_pieces_per_kg"),
    ]

    operations = [
        migrations.RunPython(forward, noop_reverse),
    ]
