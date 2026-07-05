"""Employee handover packs — ERP activity + role knowledge for Brain onboarding."""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from django.db.models import Q
from django.utils import timezone

from api.models import (
    BackupRestoreAudit,
    BrainConversation,
    BrainMessage,
    BrainUsageLog,
    Employee,
    EmployeeHandoverProfile,
    User,
)
from api.services.brain.company_documents import fetch_relevant_documents


def resolve_user_ids_for_employee(employee: Employee) -> list[int]:
    """Match ERP login User rows to an Employee record (email / username)."""
    ids: list[int] = []
    email = (employee.email or "").strip().lower()
    if not email:
        return ids
    for user in User.objects.filter(company_id=employee.company_id, is_active=True):
        u_email = (user.email or "").strip().lower()
        u_name = (user.username or "").strip().lower()
        if u_email == email or u_name == email:
            ids.append(user.id)
    return ids


def match_employee_for_user(user: User | None, company_id: int) -> Employee | None:
    if not user:
        return None
    email = (user.email or user.username or "").strip()
    if not email:
        return None
    return (
        Employee.objects.filter(company_id=company_id, is_active=True)
        .filter(Q(email__iexact=email) | Q(email__iexact=user.username or ""))
        .first()
    )


def build_erp_activity_summary(employee: Employee, *, days: int = 90) -> dict[str, Any]:
    since = timezone.now() - timedelta(days=days)
    user_ids = resolve_user_ids_for_employee(employee)
    company_id = employee.company_id

    brain_conversations = 0
    brain_questions: list[str] = []
    brain_requests = 0
    if user_ids:
        conv_qs = BrainConversation.objects.filter(company_id=company_id, user_id__in=user_ids, updated_at__gte=since)
        brain_conversations = conv_qs.count()
        brain_requests = BrainUsageLog.objects.filter(
            company_id=company_id, user_id__in=user_ids, created_at__gte=since
        ).count()
        for conv in conv_qs.order_by("-updated_at")[:5]:
            msg = (
                BrainMessage.objects.filter(conversation_id=conv.id, role=BrainMessage.ROLE_USER)
                .order_by("-created_at")
                .first()
            )
            if msg and msg.content:
                brain_questions.append(msg.content.strip()[:200])

    backup_actions = 0
    if user_ids:
        backup_actions = BackupRestoreAudit.objects.filter(
            company_id=company_id,
            actor_user_id__in=user_ids,
            created_at__gte=since,
        ).count()

    return {
        "period_days": days,
        "linked_user_ids": user_ids,
        "brain_conversations": brain_conversations,
        "brain_ai_requests": brain_requests,
        "recent_brain_questions": brain_questions[:8],
        "backup_restore_actions": backup_actions,
        "note_bn": (
            "ERP-তে সরাসরি 'created_by' ট্র্যাকিং সীমিত — Brain চ্যাট, ব্যাকআপ অডিট ও লগইন-ম্যাচিং দিয়ে কার্যকলাপের সারাংশ।"
            if not user_ids
            else None
        ),
    }


def build_open_items_hint(company_id: int, employee: Employee) -> list[dict[str, str]]:
    """Lightweight open-work hints for handover (from company snapshot modules when available)."""
    from api.services.brain import analytics

    items: list[dict[str, str]] = []
    try:
        snap = analytics.build_company_knowledge_snapshot(company_id)
    except Exception:
        return items
    mods = (snap or {}).get("erp_modules") or {}
    ar = mods.get("sales_customers_ar") or {}
    overdue = ar.get("overdue_invoices") or []
    if overdue:
        items.append(
            {
                "type": "overdue_ar",
                "label_bn": f"বকেয়া ইনভয়েস: {len(overdue)}টি — সংগ্রহ follow-up দরকার",
            }
        )
    inv = mods.get("inventory_stock") or {}
    low = inv.get("low_stock_items") or []
    if low:
        items.append(
            {
                "type": "low_stock",
                "label_bn": f"লো স্টক আইটেম: {len(low)}টি",
            }
        )
    dept = (employee.department or "").lower()
    if "pond" in dept or "aquaculture" in dept or employee.home_aquaculture_pond_id:
        items.append(
            {
                "type": "aquaculture",
                "label_bn": "পুকুর/feeding/sampling রেকর্ড আপ টু ডেট রাখুন — Brain FCR ও ঝুঁকি দেখায়।",
            }
        )
    return items[:8]


def _default_week_one_plan(job_title: str, department: str) -> list[str]:
    title = (job_title or department or "role").strip()
    return [
        f"দিন ১–২: {title} — Brain-এ 'আমি এই পদে নতুন' জিজ্ঞেস করে handover সারাংশ নিন।",
        "দিন ৩–৪: ERP-এ open invoices/bills/stock যাচাই করুন (Brain-এ জিজ্ঞেস করুন)।",
        "সপ্তাহ ১ শেষ: manager-কে missing SOP/contacts Brain documents-এ আপলোড করতে বলুন।",
    ]


def generate_handover_profile(
    employee: Employee,
    *,
    predecessor: Employee | None = None,
    handover_notes_bn: str = "",
    handover_notes_en: str = "",
    contacts_and_channels: list[dict[str, Any]] | None = None,
    generated_by: User | None = None,
    publish: bool = True,
) -> EmployeeHandoverProfile:
    activity = build_erp_activity_summary(employee)
    open_items = build_open_items_hint(employee.company_id, employee)
    job_title = (employee.job_title or "").strip()
    department = (employee.department or "").strip()

    profile = EmployeeHandoverProfile.objects.create(
        company_id=employee.company_id,
        employee=employee,
        predecessor=predecessor,
        job_title_snapshot=job_title,
        department_snapshot=department,
        status=EmployeeHandoverProfile.STATUS_PUBLISHED if publish else EmployeeHandoverProfile.STATUS_DRAFT,
        erp_activity_summary=activity,
        open_items=open_items,
        week_one_plan_bn=_default_week_one_plan(job_title, department),
        contacts_and_channels=contacts_and_channels or [],
        handover_notes_bn=(handover_notes_bn or "")[:8000],
        handover_notes_en=(handover_notes_en or "")[:8000],
        is_current_for_role=True,
        generated_by=generated_by,
    )

    if publish and job_title:
        EmployeeHandoverProfile.objects.filter(
            company_id=employee.company_id,
            job_title_snapshot__iexact=job_title,
            status=EmployeeHandoverProfile.STATUS_PUBLISHED,
        ).exclude(pk=profile.pk).update(is_current_for_role=False)

    return profile


def serialize_handover(profile: EmployeeHandoverProfile) -> dict[str, Any]:
    emp = profile.employee
    pred = profile.predecessor
    return {
        "id": profile.id,
        "employee_id": emp.id if emp else None,
        "employee_name": f"{getattr(emp, 'first_name', '')} {getattr(emp, 'last_name', '')}".strip() if emp else "",
        "predecessor_id": pred.id if pred else None,
        "predecessor_name": f"{getattr(pred, 'first_name', '')} {getattr(pred, 'last_name', '')}".strip() if pred else "",
        "job_title": profile.job_title_snapshot,
        "department": profile.department_snapshot,
        "status": profile.status,
        "erp_activity_summary": profile.erp_activity_summary or {},
        "open_items": profile.open_items or [],
        "week_one_plan_bn": profile.week_one_plan_bn or [],
        "contacts_and_channels": profile.contacts_and_channels or [],
        "handover_notes_bn": profile.handover_notes_bn,
        "handover_notes_en": profile.handover_notes_en,
        "is_current_for_role": profile.is_current_for_role,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def find_handover_for_question(
    company_id: int,
    question: str,
    *,
    current_employee: Employee | None = None,
) -> list[dict[str, Any]]:
    q = (question or "").lower()
    qs = EmployeeHandoverProfile.objects.filter(
        company_id=company_id,
        status=EmployeeHandoverProfile.STATUS_PUBLISHED,
    ).select_related("employee", "predecessor")

    if current_employee and not re.search(r"(replace|predecessor|previous|আগের|handover)", q):
        qs = qs.filter(
            Q(employee_id=current_employee.id)
            | Q(job_title_snapshot__iexact=(current_employee.job_title or "").strip())
        )
    elif current_employee and current_employee.job_title:
        qs = qs.filter(job_title_snapshot__iexact=current_employee.job_title.strip())

    profiles = list(qs.order_by("-is_current_for_role", "-updated_at")[:5])
    return [serialize_handover(p) for p in profiles]


def build_onboarding_context(
    company_id: int,
    question: str,
    *,
    user: User | None = None,
) -> dict[str, Any]:
    current_employee = match_employee_for_user(user, company_id)
    handovers = find_handover_for_question(company_id, question, current_employee=current_employee)
    docs = fetch_relevant_documents(
        company_id,
        question,
        department=(current_employee.department if current_employee else "") or "",
        job_title=(current_employee.job_title if current_employee else "") or "",
    )
    return {
        "current_employee": {
            "id": current_employee.id,
            "name": f"{current_employee.first_name} {current_employee.last_name}".strip(),
            "job_title": current_employee.job_title,
            "department": current_employee.department,
        }
        if current_employee
        else None,
        "handover_profiles": handovers,
        "company_documents": docs,
        "onboarding_mode": True,
    }
