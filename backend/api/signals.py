"""Django signals for the api app."""

from django.db.models.signals import post_migrate
from django.dispatch import receiver


@receiver(post_migrate)
def ensure_master_template_after_migrate(sender, **kwargs):
    """After api migrations, ensure FS-000001 demo tenant exists with baseline seed data."""
    if sender.name != "api":
        return
    from api.services.master_template import ensure_master_template_bootstrap

    ensure_master_template_bootstrap()
