"""Company SOP / process documents for Brain onboarding."""
from __future__ import annotations

import os
import re
import uuid
from typing import Any

from django.conf import settings

from api.models import BrainCompanyDocument, User

TEXT_EXTENSIONS = frozenset({".txt", ".md", ".csv", ".json", ".log"})
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_EXCERPT_CHARS = 12000


def _media_root() -> str:
    return getattr(settings, "MEDIA_ROOT", None) or os.path.join(settings.BASE_DIR, "media")


def _extract_text(path: str, ext: str) -> str:
    if ext not in TEXT_EXTENSIONS:
        return ""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(MAX_EXCERPT_CHARS + 1)[:MAX_EXCERPT_CHARS]
    except OSError:
        return ""


def save_company_document(
    *,
    company_id: int,
    title: str,
    file_obj,
    description: str = "",
    department: str = "",
    role_tags: list[str] | None = None,
    uploaded_by: User | None = None,
) -> BrainCompanyDocument:
    ext = os.path.splitext(file_obj.name or "")[1].lower() or ".bin"
    if file_obj.size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).")

    rel_dir = f"brain_docs/{company_id}"
    filename = f"{uuid.uuid4().hex}{ext}"
    rel_path = f"{rel_dir}/{filename}"
    abs_dir = os.path.join(_media_root(), rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    abs_path = os.path.join(_media_root(), rel_path)

    with open(abs_path, "wb") as out:
        for chunk in file_obj.chunks():
            out.write(chunk)

    excerpt = _extract_text(abs_path, ext)
    tags = [t.strip().lower()[:64] for t in (role_tags or []) if (t or "").strip()]

    return BrainCompanyDocument.objects.create(
        company_id=company_id,
        title=(title or file_obj.name or "Document")[:200],
        description=(description or "")[:4000],
        department=(department or "")[:120],
        role_tags=tags,
        file_path=rel_path,
        original_filename=(file_obj.name or "")[:255],
        content_type=(getattr(file_obj, "content_type", "") or "")[:128],
        file_size=int(file_obj.size or 0),
        text_excerpt=excerpt,
        uploaded_by=uploaded_by,
    )


def list_company_documents(company_id: int, *, active_only: bool = True) -> list[dict[str, Any]]:
    qs = BrainCompanyDocument.objects.filter(company_id=company_id)
    if active_only:
        qs = qs.filter(is_active=True)
    return [
        {
            "id": d.id,
            "title": d.title,
            "description": d.description,
            "department": d.department,
            "role_tags": d.role_tags or [],
            "original_filename": d.original_filename,
            "file_size": d.file_size,
            "has_text": bool(d.text_excerpt),
            "download_url": f"/media/{d.file_path}",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        }
        for d in qs.order_by("-updated_at")[:100]
    ]


def _tokenize(text: str) -> set[str]:
    return {w for w in re.split(r"[\W_]+", (text or "").lower()) if len(w) >= 3}


def fetch_relevant_documents(
    company_id: int,
    question: str,
    *,
    department: str = "",
    job_title: str = "",
    limit: int = 8,
) -> list[dict[str, Any]]:
    qs = BrainCompanyDocument.objects.filter(company_id=company_id, is_active=True).order_by("-updated_at")
    q_tokens = _tokenize(question)
    dept = (department or "").strip().lower()
    title = (job_title or "").strip().lower()
    scored: list[tuple[int, BrainCompanyDocument]] = []

    for doc in qs[:80]:
        score = 0
        if dept and dept in (doc.department or "").lower():
            score += 3
        for tag in doc.role_tags or []:
            t = (tag or "").lower()
            if t and (t in title or t in (question or "").lower()):
                score += 2
        doc_tokens = _tokenize(f"{doc.title} {doc.description} {doc.text_excerpt[:500]}")
        score += len(q_tokens & doc_tokens)
        if score > 0 or not q_tokens:
            scored.append((score, doc))

    scored.sort(key=lambda x: (-x[0], -x[1].updated_at.timestamp() if x[1].updated_at else 0))
    if not scored:
        scored = [(0, d) for d in qs[:limit]]

    out: list[dict[str, Any]] = []
    for _score, doc in scored[:limit]:
        out.append(
            {
                "id": doc.id,
                "title": doc.title,
                "department": doc.department,
                "role_tags": doc.role_tags or [],
                "description": doc.description,
                "text_excerpt": (doc.text_excerpt or "")[:4000],
                "download_url": f"/media/{doc.file_path}",
            }
        )
    return out
