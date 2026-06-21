"""
Tenant UI language (en / bn) — shared across modules.
Company.language drives which string variant is shown.

Convention: Bangla prose uses Bengali script; digits stay Western (0-9).
"""
from __future__ import annotations

from typing import Literal

from django.http import HttpRequest

AppLang = Literal["en", "bn"]

ALLOWED_APP_LANGUAGES = frozenset({"en", "bn"})


def normalize_lang(lang: str | None) -> AppLang:
    s = (lang or "en").strip().lower()
    return "bn" if s == "bn" else "en"


def company_language(company_id: int | None) -> AppLang:
    if not company_id:
        return "en"
    from api.models import Company

    raw = Company.objects.filter(pk=company_id).values_list("language", flat=True).first()
    return normalize_lang(raw)


def lang_from_request(request: HttpRequest) -> AppLang:
    cid = getattr(request, "company_id", None)
    return company_language(cid)


def pick(lang: str | None, en: str, bn: str) -> str:
    return bn if normalize_lang(lang) == "bn" else en


def pick_for_company(company_id: int | None, en: str, bn: str) -> str:
    return pick(company_language(company_id), en, bn)


def pick_for_request(request: HttpRequest, en: str, bn: str) -> str:
    return pick(lang_from_request(request), en, bn)
