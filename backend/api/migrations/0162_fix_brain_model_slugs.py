"""Fix Brain model fields that contain API keys or retired OpenRouter slugs."""
from __future__ import annotations

import re

from django.db import migrations

DEFAULT_FREE = "google/gemini-3.5-flash"
DEFAULT_VENDOR = "anthropic/claude-sonnet-5"
DEFAULT_RESEARCH = "perplexity/sonar"
RETIRED = {
    "google/gemini-2.0-flash-001",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.5-haiku",
}
_API_KEY_RE = re.compile(r"^sk-or-", re.IGNORECASE)


def _fix_model(value: str, default: str) -> str:
    v = (value or "").strip()
    if not v or _API_KEY_RE.match(v) or v in RETIRED:
        return default
    return v


def forwards(apps, schema_editor):
    PlatformBrainConfig = apps.get_model("api", "PlatformBrainConfig")
    cfg = PlatformBrainConfig.objects.filter(pk=1).first()
    if cfg is None:
        return
    free = _fix_model(cfg.free_model_reasoning, DEFAULT_FREE)
    vendor = _fix_model(cfg.vendor_model_reasoning, DEFAULT_VENDOR)
    research = _fix_model(cfg.vendor_model_research, DEFAULT_RESEARCH)
    if (
        free != cfg.free_model_reasoning
        or vendor != cfg.vendor_model_reasoning
        or research != cfg.vendor_model_research
    ):
        cfg.free_model_reasoning = free
        cfg.vendor_model_reasoning = vendor
        cfg.vendor_model_research = research
        cfg.save(update_fields=["free_model_reasoning", "vendor_model_reasoning", "vendor_model_research"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0161_seed_brain_knowledge_sources"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
