"""Company Brain API — status, chat (offline mode without OpenRouter)."""
from __future__ import annotations

import pytest

from api.models import BrainConversation, BrainMessage


@pytest.mark.django_db
def test_brain_status(api_client, auth_super_headers, company_master):
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    r = api_client.get("/api/brain/status/", **h)
    assert r.status_code == 200
    data = r.json()
    assert data["plan"] == "free"
    assert "messages_used_today" in data


@pytest.mark.django_db
def test_brain_hello_greeting(api_client, auth_super_headers, company_master, monkeypatch):
    """Short hello must not 500 — uses greeting fast-path without heavy snapshot/LLM."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}

    create = api_client.post("/api/brain/conversations/", {}, content_type="application/json", **h)
    assert create.status_code == 201
    conv_id = create.json()["id"]

    msg = api_client.post(
        f"/api/brain/conversations/{conv_id}/messages/",
        {"message": "Hello"},
        content_type="application/json",
        **h,
    )
    assert msg.status_code == 200, msg.content
    assistant = msg.json()["assistant_message"]
    assert assistant["role"] == "assistant"
    assert assistant["content"]
    assert "নমস্কার" in assistant["content"] or "কোম্পানি ব্রেইন" in assistant["content"]
    assert assistant.get("model_used") == "erp-greeting"


@pytest.mark.django_db
def test_brain_banglish_profit_offline(api_client, auth_super_headers, company_master, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    create = api_client.post("/api/brain/conversations/", {}, content_type="application/json", **h)
    conv_id = create.json()["id"]
    msg = api_client.post(
        f"/api/brain/conversations/{conv_id}/messages/",
        {"message": "profit koto this month"},
        content_type="application/json",
        **h,
    )
    assert msg.status_code == 200, msg.content
    assert msg.json()["assistant_message"]["content"]


@pytest.mark.django_db
def test_brain_casual_chat_offline(api_client, auth_super_headers, company_master, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}
    create = api_client.post("/api/brain/conversations/", {}, content_type="application/json", **h)
    conv_id = create.json()["id"]
    msg = api_client.post(
        f"/api/brain/conversations/{conv_id}/messages/",
        {"message": "tumi ki korte paro"},
        content_type="application/json",
        **h,
    )
    assert msg.status_code == 200, msg.content
    body = msg.json()["assistant_message"]["content"]
    assert "ব্রেইন" in body or "পারি" in body
    assert msg.json()["assistant_message"].get("model_used") == "erp-chat"


@pytest.mark.django_db
def test_brain_chat_offline(api_client, auth_super_headers, company_master, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    h = {**auth_super_headers, "HTTP_X_SELECTED_COMPANY_ID": str(company_master.id)}

    create = api_client.post("/api/brain/conversations/", {}, content_type="application/json", **h)
    assert create.status_code == 201
    conv_id = create.json()["id"]

    msg = api_client.post(
        f"/api/brain/conversations/{conv_id}/messages/",
        {"message": "আমার কোম্পানির সারাংশ কী?"},
        content_type="application/json",
        **h,
    )
    assert msg.status_code == 200
    body = msg.json()
    assistant = body["assistant_message"]
    assert assistant["role"] == "assistant"
    assert assistant["content"]
    structured = assistant.get("structured") or {}
    assert structured.get("reasoning_steps_bn")
    assert isinstance(structured.get("sources"), list)

    assert BrainMessage.objects.filter(conversation_id=conv_id).count() == 2
    assert BrainConversation.objects.filter(pk=conv_id).exists()
