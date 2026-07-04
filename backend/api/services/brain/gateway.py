"""OpenRouter-compatible LLM gateway — retry, fallback, timeout, token tracking."""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from api.services.brain import config as brain_config

logger = logging.getLogger(__name__)


@dataclass
class CompletionResult:
    content: str | None
    error: str | None
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    used_fallback: bool = False


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def openrouter_base_url() -> str:
    return _env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1/chat/completions")


def default_model() -> str:
    return _env("OPENROUTER_DEFAULT_MODEL", "")


def fallback_model() -> str:
    return _env("OPENROUTER_FALLBACK_MODEL", "google/gemini-2.0-flash-001")


def openrouter_configured(*, plan: str | None = None) -> bool:
    return brain_config.openrouter_configured(plan=plan)


def model_for_role(role: str, *, plan: str) -> str:
    """Map internal role to OpenRouter model id (DB config + env fallback)."""
    models = brain_config.models_for_plan(plan)
    if role == "research":
        return models["research"]
    if role == "reasoning":
        return models["reasoning"]
    return models["fast"]


def _parse_usage(data: dict[str, Any]) -> tuple[int, int, int]:
    usage = data.get("usage") or {}
    prompt = int(usage.get("prompt_tokens") or 0)
    completion = int(usage.get("completion_tokens") or 0)
    total = int(usage.get("total_tokens") or prompt + completion)
    return prompt, completion, total


def _request_completion(
    *,
    messages: list[dict[str, str]],
    model: str,
    api_key: str,
    temperature: float,
    max_tokens: int,
    timeout: int,
) -> CompletionResult:
    if not api_key:
        return CompletionResult(
            content=None,
            error="Brain API key not configured (SaaS Admin → Brain API or OPENROUTER_API_KEY)",
            model=model,
        )

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        openrouter_base_url(),
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": _env("FRONTEND_BASE_URL", "https://mahasoftcorporation.com"),
            "X-Title": "FSERP Company Brain",
        },
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read().decode("utf-8")
            detail = json.loads(err_body).get("error", {}).get("message", err_body)
        except Exception:
            detail = str(exc)
        logger.warning("OpenRouter HTTP error model=%s: %s", model, detail)
        return CompletionResult(
            content=None,
            error=detail,
            model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    except Exception as exc:
        logger.warning("OpenRouter request failed model=%s: %s", model, exc)
        return CompletionResult(
            content=None,
            error=str(exc),
            model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    latency_ms = int((time.monotonic() - started) * 1000)
    choices = data.get("choices") or []
    if not choices:
        return CompletionResult(
            content=None,
            error="Empty model response",
            model=model,
            latency_ms=latency_ms,
        )
    content = (choices[0].get("message") or {}).get("content") or ""
    prompt_t, completion_t, total_t = _parse_usage(data)
    return CompletionResult(
        content=content,
        error=None,
        model=model,
        prompt_tokens=prompt_t,
        completion_tokens=completion_t,
        total_tokens=total_t,
        latency_ms=latency_ms,
    )


def chat_completion_with_meta(
    *,
    messages: list[dict[str, str]],
    model: str,
    api_key: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
    timeout: int | None = None,
    retries: int = 2,
    fallback: str | None = None,
) -> CompletionResult:
    """
    Call OpenRouter with retry and optional fallback model.
    """
    key = (api_key or brain_config.env_api_key()).strip()
    timeout_sec = timeout if timeout is not None else int(_env("OPENROUTER_TIMEOUT", "120") or "120")
    fb = (fallback or fallback_model() or "").strip()
    primary = (model or default_model() or fb).strip()

    last = CompletionResult(content=None, error="No attempt", model=primary)
    for attempt in range(max(1, retries + 1)):
        last = _request_completion(
            messages=messages,
            model=primary,
            api_key=key,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout_sec,
        )
        if last.content and not last.error:
            return last
        if attempt < retries:
            logger.info("OpenRouter retry %s for model=%s", attempt + 1, primary)

    if fb and fb != primary:
        fb_result = _request_completion(
            messages=messages,
            model=fb,
            api_key=key,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout_sec,
        )
        if fb_result.content and not fb_result.error:
            fb_result.used_fallback = True
            return fb_result
        last = fb_result

    return last


def chat_completion(
    *,
    messages: list[dict[str, str]],
    model: str,
    api_key: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> tuple[str | None, str | None]:
    """
    Backward-compatible wrapper — returns (content_text, error_message).
    """
    result = chat_completion_with_meta(
        messages=messages,
        model=model,
        api_key=api_key,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return result.content, result.error


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
