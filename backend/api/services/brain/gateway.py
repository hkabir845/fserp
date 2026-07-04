"""OpenRouter-compatible LLM gateway (single vendor, many models)."""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions"


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def openrouter_configured() -> bool:
    return bool(_env("OPENROUTER_API_KEY"))


def model_for_role(role: str, *, plan: str) -> str:
    """Map internal role to OpenRouter model id."""
    if role == "research":
        return _env("BRAIN_MODEL_RESEARCH", "perplexity/sonar")
    if role == "reasoning":
        return _env(
            "BRAIN_MODEL_REASONING",
            "anthropic/claude-3.5-sonnet" if plan != "free" else "google/gemini-2.0-flash-001",
        )
    return _env("BRAIN_MODEL_FAST", "google/gemini-2.0-flash-001")


def chat_completion(
    *,
    messages: list[dict[str, str]],
    model: str,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> tuple[str | None, str | None]:
    """
    Returns (content_text, error_message).
    Uses stdlib urllib — no extra dependency.
    """
    api_key = _env("OPENROUTER_API_KEY")
    if not api_key:
        return None, "OPENROUTER_API_KEY not configured"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_BASE,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": _env("FRONTEND_BASE_URL", "https://mahasoftcorporation.com"),
            "X-Title": "FSERP Company Brain",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read().decode("utf-8")
            detail = json.loads(err_body).get("error", {}).get("message", err_body)
        except Exception:
            detail = str(exc)
        logger.warning("OpenRouter HTTP error: %s", detail)
        return None, detail
    except Exception as exc:
        logger.warning("OpenRouter request failed: %s", exc)
        return None, str(exc)

    choices = data.get("choices") or []
    if not choices:
        return None, "Empty model response"
    content = (choices[0].get("message") or {}).get("content") or ""
    return content, None


def parse_structured_json(raw: str) -> dict[str, Any] | None:
    """Extract JSON object from model output (plain or fenced)."""
    text = (raw or "").strip()
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1)
    elif text.startswith("{"):
        pass
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
        else:
            return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
