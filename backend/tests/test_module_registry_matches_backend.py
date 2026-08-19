"""
The module registry must not advertise screens the backend cannot serve.

The frontend carries a large planned-ERP surface (procurement, CRM, lab, transport, workshop,
manufacturing and more) whose pages render but whose API calls 404. Those entries are marked
`status: 'planned'` so the UI shows them as unavailable instead of linking into a dead screen.

This test keeps that honest in the one direction that matters: a link left unmarked - and so
presented to users as working - must call only routes the Django URLconf actually serves. It
parses the registry rather than importing it, so it needs no Node toolchain in CI.
"""
from __future__ import annotations

import io
import os
import re

import pytest
from django.urls import Resolver404, resolve

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_SRC = os.path.join(os.path.dirname(BACKEND_DIR), "frontend", "src")

# Files that declare hub links shown to users.
LINK_FILES = [
    os.path.join(FRONTEND_SRC, "config", "app-modules.ts"),
    os.path.join(FRONTEND_SRC, "app", "platform", "tenants", "page.tsx"),
    os.path.join(FRONTEND_SRC, "app", "platform", "billing", "page.tsx"),
]

LINK_RE = re.compile(
    r"\{\s*title:\s*'(?P<title>[^']*)',\s*href:\s*'(?P<href>[^']*)',\s*icon:\s*'[^']*'"
    r"(?P<rest>(?:[^{}]|\{[^{}]*\})*?)\}"
)
API_CALL = re.compile(r"api\.(?:get|post|put|delete|patch)\s*[<(][^,)]*?['\"`](/[a-zA-Z0-9/_\-${}.]+)")
REDIRECT = re.compile(r"redirect\(\s*['\"`](/[a-zA-Z0-9/_\-]+)")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(FRONTEND_SRC), reason="frontend source not present in this checkout"
)


def _page_for(href: str) -> str | None:
    rel = href.strip("/")
    for base in (os.path.join(FRONTEND_SRC, "app"), os.path.join(FRONTEND_SRC, "app", "(erp)")):
        f = os.path.join(base, rel, "page.tsx")
        if os.path.exists(f):
            return f
    return None


def _route_served(api_path: str) -> bool:
    """Would Django route this call? Template segments stand in as a plausible id."""
    p = re.sub(r"\$\{[^}]*\}", "1", api_path.strip().split("?")[0])
    if not p.startswith("/"):
        p = "/" + p
    candidates = [f"/api{p}"]
    if not p.endswith("/"):
        candidates.append(f"/api{p}/")
    for c in candidates:
        try:
            resolve(c)
            return True
        except Resolver404:
            continue
    return False


def _unserved_calls(href: str, depth: int = 0) -> list[str]:
    page = _page_for(href)
    if page is None:
        return [f"(no page file for {href})"]
    src = io.open(page, encoding="utf-8").read()
    calls = sorted(set(API_CALL.findall(src)))
    if not calls and depth < 3:
        m = REDIRECT.search(src)
        if m:
            return _unserved_calls(m.group(1), depth + 1)
    return [c for c in calls if not _route_served(c)]


def _iter_links():
    for path in LINK_FILES:
        if not os.path.exists(path):
            continue
        src = io.open(path, encoding="utf-8").read()
        for m in LINK_RE.finditer(src):
            yield (
                os.path.basename(path),
                m.group("title"),
                m.group("href"),
                "status: 'planned'" in m.group(0),
            )


def test_the_registry_declares_some_links():
    """A parsing regression would make every other assertion here vacuously pass."""
    links = list(_iter_links())
    assert len(links) > 40, f"only parsed {len(links)} hub links - the regex probably broke"


def test_links_shown_as_available_are_actually_served_by_the_backend():
    offenders: list[str] = []
    for filename, title, href, planned in _iter_links():
        if planned or href.startswith("http"):
            continue
        missing = _unserved_calls(href)
        if missing:
            offenders.append(f"{filename}: '{title}' -> {href} calls {', '.join(missing[:4])}")
    assert not offenders, (
        "These hub links are presented as working but call routes the backend does not serve. "
        "Either build the endpoints or mark the link status: 'planned'.\n  "
        + "\n  ".join(sorted(offenders))
    )


def test_planned_links_are_really_still_unbuilt():
    """When a module does get built, its link should stop claiming to be planned."""
    stale: list[str] = []
    for filename, title, href, planned in _iter_links():
        if not planned:
            continue
        if not _unserved_calls(href):
            stale.append(f"{filename}: '{title}' -> {href}")
    assert not stale, (
        "These links are marked planned but their backend now exists - drop the status flag so "
        "users can reach them:\n  " + "\n  ".join(sorted(stale))
    )
