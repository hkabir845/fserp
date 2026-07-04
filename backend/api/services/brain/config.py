"""Platform Brain API keys — SaaS UI with env fallback."""
from __future__ import annotations

import os
import re
from typing import Any

from api.models import PlatformBrainConfig

_PAID_BRAIN_PLANS = frozenset({"growth", "enterprise"})

_MASK_RE = re.compile(r"^[•*.\s]+$")


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 10:
        return "••••••••"
    return f"{k[:6]}••••••••{k[-4:]}"


def _looks_like_mask(value: str) -> bool:
    v = (value or "").strip()
    return not v or "•" in v or _MASK_RE.match(v) is not None


def get_platform_brain_config() -> PlatformBrainConfig | None:
    try:
        row, _ = PlatformBrainConfig.objects.get_or_create(pk=1)
        return row
    except Exception:
        return None


def _cfg_or_defaults() -> PlatformBrainConfig:
    cfg = get_platform_brain_config()
    if cfg is not None:
        return cfg
    # Env-only fallback when migration not applied yet
    return PlatformBrainConfig(
        pk=1,
        free_api_key="",
        vendor_api_key="",
        free_model_reasoning="google/gemini-2.0-flash-001",
        vendor_model_reasoning="anthropic/claude-3.5-sonnet",
        vendor_model_research="perplexity/sonar",
    )


def env_api_key() -> str:
    return _env("OPENROUTER_API_KEY")


def _resolve_api_key(plan: str) -> tuple[str, str, str]:
    """Return (source_label, masked_key, raw_key) for a Brain plan tier."""
    cfg = _cfg_or_defaults()
    free = (cfg.free_api_key or "").strip()
    vendor = (cfg.vendor_api_key or "").strip()
    env_key = env_api_key()

    if plan in _PAID_BRAIN_PLANS:
        if vendor:
            return "vendor_api_key", mask_api_key(vendor), vendor
        if free:
            return "free_api_key", mask_api_key(free), free
        if env_key:
            return "OPENROUTER_API_KEY (server env)", mask_api_key(env_key), env_key
        return "none", "", ""

    if free:
        return "free_api_key", mask_api_key(free), free
    if env_key:
        return "OPENROUTER_API_KEY (server env)", mask_api_key(env_key), env_key
    if vendor:
        return "vendor_api_key (fallback)", mask_api_key(vendor), vendor
    return "none", "", ""


def api_key_for_plan(plan: str) -> str:
    _source, _masked, raw = _resolve_api_key(plan)
    return raw


def openrouter_configured(*, plan: str | None = None) -> bool:
    if plan:
        return bool(api_key_for_plan(plan))
    cfg = get_platform_brain_config()
    if cfg is None:
        return bool(env_api_key())
    return bool(
        (cfg.free_api_key or "").strip()
        or (cfg.vendor_api_key or "").strip()
        or env_api_key()
    )


def models_for_plan(plan: str) -> dict[str, str]:
    cfg = _cfg_or_defaults()
    if plan in _PAID_BRAIN_PLANS:
        reasoning = (cfg.vendor_model_reasoning or "").strip() or _env(
            "BRAIN_MODEL_REASONING", "anthropic/claude-3.5-sonnet"
        )
        research = (cfg.vendor_model_research or "").strip() or _env(
            "BRAIN_MODEL_RESEARCH", "perplexity/sonar"
        )
    else:
        reasoning = (cfg.free_model_reasoning or "").strip() or _env(
            "BRAIN_MODEL_REASONING", "google/gemini-2.0-flash-001"
        )
        research = _env("BRAIN_MODEL_RESEARCH", "perplexity/sonar")
    fast = _env("BRAIN_MODEL_FAST", reasoning)
    return {"fast": fast, "reasoning": reasoning, "research": research}


def serialize_brain_config_for_admin() -> dict[str, Any]:
    cfg = get_platform_brain_config()
    if cfg is None:
        env_key = env_api_key()
        return {
            "free_api_key_set": False,
            "free_api_key_masked": "",
            "vendor_api_key_set": False,
            "vendor_api_key_masked": "",
            "free_model_reasoning": "google/gemini-2.0-flash-001",
            "vendor_model_reasoning": "anthropic/claude-3.5-sonnet",
            "vendor_model_research": "perplexity/sonar",
            "env_fallback_configured": bool(env_key),
            "env_fallback_masked": mask_api_key(env_key) if env_key else "",
            "llm_ready_free": bool(env_key),
            "llm_ready_vendor": bool(env_key),
            "updated_at": None,
            "migration_pending": True,
        }
    env_key = env_api_key()
    free_set = bool((cfg.free_api_key or "").strip())
    vendor_set = bool((cfg.vendor_api_key or "").strip())
    free_src, free_active_masked, _ = _resolve_api_key("free")
    vendor_src, vendor_active_masked, _ = _resolve_api_key("growth")
    return {
        "free_api_key_set": free_set,
        "free_api_key_masked": mask_api_key(cfg.free_api_key) if free_set else "",
        "vendor_api_key_set": vendor_set,
        "vendor_api_key_masked": mask_api_key(cfg.vendor_api_key) if vendor_set else "",
        "free_model_reasoning": cfg.free_model_reasoning or "google/gemini-2.0-flash-001",
        "vendor_model_reasoning": cfg.vendor_model_reasoning or "anthropic/claude-3.5-sonnet",
        "vendor_model_research": cfg.vendor_model_research or "perplexity/sonar",
        "env_fallback_configured": bool(env_key),
        "env_fallback_masked": mask_api_key(env_key) if env_key else "",
        "llm_ready_free": free_set or bool(env_key) or vendor_set,
        "llm_ready_vendor": vendor_set or bool(env_key) or free_set,
        "active_key_free_plan_source": free_src,
        "active_key_free_plan_masked": free_active_masked,
        "active_key_paid_plan_source": vendor_src,
        "active_key_paid_plan_masked": vendor_active_masked,
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
    }


def update_brain_config_from_admin(body: dict[str, Any], *, user_id: int | None) -> PlatformBrainConfig:
    cfg = get_platform_brain_config()
    if cfg is None:
        raise ValueError("platform_brain_config table missing — run migrations (0159)")

    for field in ("free_model_reasoning", "vendor_model_reasoning", "vendor_model_research"):
        if field in body:
            val = (str(body.get(field) or "")).strip()[:128]
            if val:
                setattr(cfg, field, val)

    if "free_api_key" in body:
        raw = (body.get("free_api_key") or "").strip()
        if raw and not _looks_like_mask(raw):
            cfg.free_api_key = raw[:256]
        elif raw == "":
            cfg.free_api_key = ""

    if "vendor_api_key" in body:
        raw = (body.get("vendor_api_key") or "").strip()
        if raw and not _looks_like_mask(raw):
            cfg.vendor_api_key = raw[:256]
        elif raw == "":
            cfg.vendor_api_key = ""

    cfg.updated_by_id = user_id
    cfg.save()
    return cfg
