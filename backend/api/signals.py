"""Django signals for the api app."""

from django.db.models.signals import post_migrate
from django.dispatch import receiver


@receiver(post_migrate)
def ensure_master_template_after_migrate(sender, **kwargs):
    """
    After api migrations: additive bootstrap only (no destructive resets).

    Ensures demo tenant + chart/products/nozzles **where missing** — existing business
    data is never deleted or replaced. Operators can review persisted counts via
    GET /api/system/tenant-data-summary/.
    """
    if sender.name != "api":
        return
    import logging

    from api.services.master_template import ensure_master_template_bootstrap

    logger = logging.getLogger(__name__)
    summary = ensure_master_template_bootstrap()
    if not summary.get("skipped"):
        logger.info(
            "post_migrate bootstrap: additive only (company_id=%s created=%s)",
            summary.get("company_id"),
            summary.get("created"),
        )
