"""Platform Brain API keys — SaaS UI with env fallback."""
from __future__ import annotations

import os
import re
from typing import Any

from api.models import PlatformBrainConfig

_PAID_BRAIN_PLANS = frozenset({"growth", "enterprise"})

DEFAULT_FREE_MODEL = "google/gemini-3.5-flash"
DEFAULT_VENDOR_MODEL = "anthropic/claude-sonnet-5"
DEFAULT_RESEARCH_MODEL = "perplexity/sonar"

# Retired OpenRouter slugs still present in older DB rows / env examples.
_RETIRED_MODEL_SLUGS = frozenset({
    "google/gemini-2.0-flash-001",
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3.5-haiku",
})

_MASK_RE = re.compile(r"^[•*.\s]+$")
_API_KEY_RE = re.compile(r"^sk-or-", re.IGNORECASE)


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


def _looks_like_api_key(value: str) -> bool:
    v = (value or "").strip()
    return bool(v) and bool(_API_KEY_RE.match(v))


def _sanitize_model_id(value: str, default: str) -> str:
    """Reject API keys / retired slugs accidentally stored in model fields."""
    v = (value or "").strip()
    if not v or _looks_like_api_key(v) or v in _RETIRED_MODEL_SLUGS:
        return default
    return v


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
        free_model_reasoning=DEFAULT_FREE_MODEL,
        vendor_model_reasoning=DEFAULT_VENDOR_MODEL,
        vendor_model_research=DEFAULT_RESEARCH_MODEL,
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
        reasoning = _sanitize_model_id(
            (cfg.vendor_model_reasoning or "").strip()
            or _env("BRAIN_MODEL_REASONING", DEFAULT_VENDOR_MODEL),
            DEFAULT_VENDOR_MODEL,
        )
        research = _sanitize_model_id(
            (cfg.vendor_model_research or "").strip()
            or _env("BRAIN_MODEL_RESEARCH", DEFAULT_RESEARCH_MODEL),
            DEFAULT_RESEARCH_MODEL,
        )
    else:
        reasoning = _sanitize_model_id(
            (cfg.free_model_reasoning or "").strip()
            or _env("BRAIN_MODEL_REASONING", DEFAULT_FREE_MODEL),
            DEFAULT_FREE_MODEL,
        )
        research = _sanitize_model_id(
            _env("BRAIN_MODEL_RESEARCH", DEFAULT_RESEARCH_MODEL),
            DEFAULT_RESEARCH_MODEL,
        )
    fast = _sanitize_model_id(_env("BRAIN_MODEL_FAST", reasoning), reasoning)
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
            "free_model_reasoning": DEFAULT_FREE_MODEL,
            "vendor_model_reasoning": DEFAULT_VENDOR_MODEL,
            "vendor_model_research": DEFAULT_RESEARCH_MODEL,
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
        "free_model_reasoning": _sanitize_model_id(cfg.free_model_reasoning, DEFAULT_FREE_MODEL),
        "vendor_model_reasoning": _sanitize_model_id(cfg.vendor_model_reasoning, DEFAULT_VENDOR_MODEL),
        "vendor_model_research": _sanitize_model_id(cfg.vendor_model_research, DEFAULT_RESEARCH_MODEL),
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

    model_defaults = {
        "free_model_reasoning": DEFAULT_FREE_MODEL,
        "vendor_model_reasoning": DEFAULT_VENDOR_MODEL,
        "vendor_model_research": DEFAULT_RESEARCH_MODEL,
    }
    for field, default in model_defaults.items():
        if field in body:
            val = (str(body.get(field) or "")).strip()[:128]
            if val and not _looks_like_api_key(val):
                setattr(cfg, field, val)
            elif val and _looks_like_api_key(val):
                raise ValueError(f"{field} must be a model slug (e.g. {default}), not an API key")

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
