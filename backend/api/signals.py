"""Django signals for the api app."""

from django.db.models.signals import post_migrate, pre_delete
from django.dispatch import receiver


@receiver(pre_delete, sender="api.JournalEntry")
def release_payroll_when_salary_journal_deleted(sender, instance, **kwargs):
    """Revert linked payroll run to draft when AUTO-PAYROLL journal is deleted."""
    en = (getattr(instance, "entry_number", None) or "").strip()
    if not en.startswith("AUTO-PAYROLL-"):
        return
    from api.services.gl_posting import release_payroll_salary_journal

    release_payroll_salary_journal(
        int(instance.company_id),
        journal_entry_id=int(instance.id),
        entry_number=en,
    )


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
