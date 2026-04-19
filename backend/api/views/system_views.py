"""Read-only system / upgrade diagnostics: visualize existing tenant data (no mutations)."""
from __future__ import annotations

from django.http import JsonResponse
from django.views.decorators.http import require_GET

from api.models import (
    Bill,
    ChartOfAccount,
    Company,
    Customer,
    Invoice,
    Item,
    JournalEntry,
    Meter,
    Nozzle,
    Payment,
    ShiftSession,
    Station,
    Tank,
    Vendor,
)
from api.utils.auth import auth_required
from api.views.common import require_company_id
from api.services.company_code import resolved_company_code


def _count(qs):
    try:
        return qs.count()
    except Exception:
        return 0


@require_GET
@auth_required
@require_company_id
def tenant_data_summary(request):
    """
    GET /api/system/tenant-data-summary/

    Read-only snapshot of persisted data for the current company after deploy/upgrade.
    Does not create, update, or delete anything. Use the normal CRUD screens to change data.
    """
    from fsms.release_info import version_payload

    cid = request.company_id
    meta = version_payload()
    co = Company.objects.filter(pk=cid, is_deleted=False).first()
    company_payload = {
        "id": cid,
        "name": (co.name if co else "") or "",
        "company_code": resolved_company_code(co) if co else "",
        "is_active": bool(co.is_active) if co else False,
        "platform_release": (getattr(co, "platform_release", None) or "").strip() if co else "",
    }

    counts = {
        "items": _count(Item.objects.filter(company_id=cid)),
        "invoices": _count(Invoice.objects.filter(company_id=cid)),
        "bills": _count(Bill.objects.filter(company_id=cid)),
        "customers": _count(Customer.objects.filter(company_id=cid)),
        "vendors": _count(Vendor.objects.filter(company_id=cid)),
        "stations": _count(Station.objects.filter(company_id=cid)),
        "tanks": _count(Tank.objects.filter(company_id=cid)),
        "meters": _count(Meter.objects.filter(company_id=cid)),
        "nozzles": _count(Nozzle.objects.filter(company_id=cid)),
        "chart_of_accounts": _count(ChartOfAccount.objects.filter(company_id=cid)),
        "journal_entries": _count(JournalEntry.objects.filter(company_id=cid)),
        "payments": _count(Payment.objects.filter(company_id=cid)),
        "shift_sessions": _count(ShiftSession.objects.filter(company_id=cid)),
    }

    return JsonResponse(
        {
            "application": meta.get("application", "FSERP"),
            "backend_version": meta.get("version", ""),
            "git_commit": meta.get("commit"),
            "server_time_utc": meta.get("time_utc"),
            "company": company_payload,
            "counts": counts,
            "data_policy": {
                "summary": (
                    "Server upgrades apply database migrations only. Your existing rows stay in the database. "
                    "Automatic bootstrap adds missing demo catalog rows (e.g. chart seed if empty, demo products by name); "
                    "it does not wipe companies, invoices, or inventory. Remove or change data only from the app, "
                    "using the relevant screens or an explicit backup/restore you control."
                ),
            },
        }
    )