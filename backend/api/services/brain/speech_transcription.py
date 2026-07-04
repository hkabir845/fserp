"""Voice transcription for Company Brain — server fallback when browser STT unavailable."""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from typing import Any

from api.services.brain import config as brain_config

logger = logging.getLogger(__name__)

OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions"
MAX_AUDIO_BYTES = 6 * 1024 * 1024  # 6 MB


def _audio_format_from_mime(mime: str) -> str:
    m = (mime or "").lower()
    if "webm" in m:
        return "webm"
    if "mp4" in m or "m4a" in m or "aac" in m:
        return "mp4"
    if "ogg" in m:
        return "ogg"
    if "wav" in m:
        return "wav"
    return "webm"


def _language_hint(language: str) -> str:
    lang = (language or "bn").strip().lower()
    if lang.startswith("bn"):
        return "Bengali (Bangla). User may mix Banglish — transcribe what was spoken."
    return "English. User may mix Banglish — transcribe what was spoken."


def transcribe_audio_bytes(
    audio_bytes: bytes,
    *,
    mime_type: str = "audio/webm",
    language: str = "bn",
    plan: str = "free",
) -> tuple[str | None, str | None]:
    """
    Transcribe recorded audio via OpenRouter multimodal model (Gemini flash).
    Used when Web Speech API is unavailable (iOS Safari, Firefox, etc.).
    """
    if not audio_bytes:
        return None, "Empty audio"
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        return None, "Audio too long (max ~60 seconds)"

    api_key = brain_config.api_key_for_plan(plan)
    if not api_key:
        return None, "Brain API key not configured"

    models = brain_config.models_for_plan(plan)
    model = models.get("fast") or models.get("reasoning") or "google/gemini-2.0-flash-001"

    fmt = _audio_format_from_mime(mime_type)
    b64 = base64.standard_b64encode(audio_bytes).decode("ascii")
    hint = _language_hint(language)

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Transcribe this voice message to plain text. {hint} "
                            "Return ONLY the transcript — no labels, quotes, or commentary."
                        ),
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {"data": b64, "format": fmt},
                    },
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 1024,
    }

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        OPENROUTER_BASE,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mahasoftcorporation.com",
            "X-Title": "FSERP Brain Voice",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read().decode("utf-8")
            detail = json.loads(err_body).get("error", {}).get("message", err_body)
        except Exception:
            detail = str(exc)
        logger.warning("Brain transcribe HTTP error: %s", detail[:300])
        return None, detail
    except Exception as exc:
        logger.warning("Brain transcribe failed: %s", exc)
        return None, str(exc)

    choices = data.get("choices") or []
    if not choices:
        return None, "Empty transcription response"
    content = (choices[0].get("message") or {}).get("content") or ""
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        text = " ".join(parts).strip()
    else:
        text = str(content).strip()
    if not text:
        return None, "No speech detected"
    return text, None
