"""Brain voice transcription service and API."""
from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from api.services.brain.speech_transcription import (
    _audio_format_from_mime,
    _language_hint,
    transcribe_audio_bytes,
)


def test_audio_format_from_mime():
    assert _audio_format_from_mime("audio/webm;codecs=opus") == "webm"
    assert _audio_format_from_mime("audio/mp4") == "mp4"
    assert _audio_format_from_mime("audio/ogg") == "ogg"


def test_language_hint():
    assert "Bengali" in _language_hint("bn")
    assert "English" in _language_hint("en")


def test_transcribe_empty_audio():
    text, err = transcribe_audio_bytes(b"", plan="free")
    assert text is None
    assert err == "Empty audio"


def test_transcribe_no_api_key(monkeypatch):
    monkeypatch.setattr(
        "api.services.brain.speech_transcription.brain_config.api_key_for_plan",
        lambda _plan: "",
    )
    text, err = transcribe_audio_bytes(b"fake", plan="free")
    assert text is None
    assert "not configured" in (err or "").lower()


def test_transcribe_success(monkeypatch):
    monkeypatch.setattr(
        "api.services.brain.speech_transcription.brain_config.api_key_for_plan",
        lambda _plan: "test-key",
    )
    monkeypatch.setattr(
        "api.services.brain.speech_transcription.brain_config.models_for_plan",
        lambda _plan: {"fast": "google/gemini-2.0-flash-001"},
    )

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"choices":[{"message":{"content":"ajker sales kemon"}}]}'

    monkeypatch.setattr(
        "api.services.brain.speech_transcription.urllib.request.urlopen",
        lambda *a, **k: FakeResp(),
    )

    text, err = transcribe_audio_bytes(b"audio-bytes", mime_type="audio/webm", language="bn")
    assert err is None
    assert text == "ajker sales kemon"


@pytest.mark.django_db
def test_brain_transcribe_requires_audio(api_client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.post("/api/brain/transcribe/", {}, **h)
    assert r.status_code == 400
    assert "audio" in r.json()["detail"].lower()


@pytest.mark.django_db
def test_brain_transcribe_no_llm(api_client, auth_super_headers, company_master, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    upload = SimpleUploadedFile("voice.webm", b"fake-audio", content_type="audio/webm")
    r = api_client.post(
        "/api/brain/transcribe/",
        {"audio": upload, "language": "bn"},
        **h,
    )
    assert r.status_code == 503


@pytest.mark.django_db
def test_brain_transcribe_success(api_client, auth_super_headers, company_master, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(
        "api.services.brain.speech_transcription.transcribe_audio_bytes",
        lambda *a, **k: ("profit koto", None),
    )
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    upload = SimpleUploadedFile("voice.webm", b"fake-audio", content_type="audio/webm")
    r = api_client.post(
        "/api/brain/transcribe/",
        {"audio": upload, "language": "en"},
        **h,
    )
    assert r.status_code == 200
    assert r.json()["transcript"] == "profit koto"
    assert r.json()["language"] == "en"
