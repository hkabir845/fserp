"""Fixed asset register API: assets, place-in-service, depreciation runs (company-scoped)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from api.models import AquaculturePond, ChartOfAccount, FixedAsset, FixedAssetDepreciationRun, Station
from api.services.fixed_asset_posting import (
    post_fixed_asset_acquisition,
    post_fixed_asset_depreciation,
    post_fixed_asset_disposal,
    post_fixed_asset_opening_accumulated_depreciation,
    reverse_fixed_asset_depreciation,
)
from api.services.reference_code import assign_string_code_if_empty, user_supplied_code_or_auto
from api.services.fixed_asset_schedule import (
    amount_for_next_run,
    book_value,
    depreciable_remaining,
    depreciation_schedule,
    run_exists_for_period,
    standard_monthly_amount,
)
from api.utils.auth import auth_required
from api.views.common import parse_json_body, require_company_id
from api.services.invoice_station import parse_valid_station_id


ALLOWED_STATUS = frozenset(
    {
        FixedAsset.STATUS_DRAFT,
        FixedAsset.STATUS_ACTIVE,
        FixedAsset.STATUS_FULLY_DEPRECIATED,
        FixedAsset.STATUS_DISPOSED,
    }
)
ALLOWED_METHODS = frozenset({FixedAsset.METHOD_STRAIGHT_LINE})
FIXED_ASSET_SUB_TYPES = frozenset(
    {
        "fixed_asset",
        "machinery_and_equipment",
        "vehicles",
    }
)
from api.services.erp_coa_defaults import ErpCoaCode

DEFAULT_GAIN_COA_CODE = ErpCoaCode.REV_INTEREST_LOAN
DEFAULT_LOSS_COA_CODE = ErpCoaCode.ASSET_DISPOSAL_LOSS


def _ser_date(d):
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def _dec(v, default=Decimal("0")) -> Decimal:
    if v is None:
        return default
    try:
        return Decimal(str(v))
    except Exception:
        return default


def _parse_date(val):
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def _coa_belongs(cid: int, aid) -> bool:
    if aid is None or aid == "":
        return False
    try:
        i = int(aid)
    except (TypeError, ValueError):
        return False
    if i <= 0:
        return False
    return ChartOfAccount.objects.filter(id=i, company_id=cid, is_active=True).exists()


def _parse_optional_positive_int(val, field_name: str):
    if val in (None, "", 0, "0"):
        return None
    try:
        i = int(val)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a positive integer")
    if i <= 0:
        raise ValueError(f"{field_name} must be a positive integer")
    return i


def _parse_required_positive_int(val, field_name: str) -> int:
    i = _parse_optional_positive_int(val, field_name)
    if i is None:
        raise ValueError(f"{field_name} is required")
    return i


def _validate_asset_account(acc: ChartOfAccount) -> bool:
    return acc.account_type == "asset" and (acc.account_sub_type or "") in FIXED_ASSET_SUB_TYPES


def _validate_accum_account(acc: ChartOfAccount) -> bool:
    return acc.account_type == "asset" and acc.account_sub_type == "accumulated_depreciation"


def _validate_expense_account(acc: ChartOfAccount) -> bool:
    return acc.account_type == "expense"


def _validate_settlement_account(acc: ChartOfAccount) -> bool:
    return acc.account_type in ("bank_account", "asset")


def _asset_json(asset: FixedAsset, *, include_runs: bool = False) -> dict:
    data = {
        "id": asset.id,
        "asset_number": asset.asset_number,
        "name": asset.name,
        "description": asset.description or "",
        "status": asset.status,
        "station_id": asset.station_id,
        "station_name": asset.station.station_name if asset.station_id and asset.station else None,
        "aquaculture_pond_id": asset.aquaculture_pond_id,
        "pond_name": asset.aquaculture_pond.name if asset.aquaculture_pond_id and asset.aquaculture_pond else None,
        "company_wide": bool(getattr(asset, "company_wide", False)),
        "cost_center_label": (
            "Head office / shared"
            if getattr(asset, "company_wide", False)
            else (asset.aquaculture_pond.name if asset.aquaculture_pond_id and asset.aquaculture_pond else None)
            or (asset.station.station_name if asset.station_id and asset.station else None)
            or "—"
        ),
        "asset_account_id": asset.asset_account_id,
        "accumulated_depreciation_account_id": asset.accumulated_depreciation_account_id,
        "depreciation_expense_account_id": asset.depreciation_expense_account_id,
        "settlement_account_id": asset.settlement_account_id,
        "acquisition_date": _ser_date(asset.acquisition_date),
        "in_service_date": _ser_date(asset.in_service_date),
        "disposal_date": _ser_date(asset.disposal_date),
        "acquisition_cost": str(asset.acquisition_cost or 0),
        "salvage_value": str(asset.salvage_value or 0),
        "depreciable_base": str(
            max((asset.acquisition_cost or Decimal("0")) - (asset.salvage_value or Decimal("0")), Decimal("0"))
        ),
        "useful_life_months": asset.useful_life_months,
        "depreciation_method": asset.depreciation_method,
        "opening_accumulated_depreciation": str(asset.opening_accumulated_depreciation or 0),
        "accumulated_depreciation": str(asset.accumulated_depreciation or 0),
        "book_value": str(book_value(asset)),
        "depreciable_remaining": str(depreciable_remaining(asset)),
        "standard_monthly_depreciation": str(standard_monthly_amount(asset)),
        "next_depreciation_amount": str(amount_for_next_run(asset)),
        "last_depreciation_date": _ser_date(asset.last_depreciation_date),
        "acquisition_journal_entry_id": asset.acquisition_journal_entry_id,
        "disposal_journal_entry_id": asset.disposal_journal_entry_id,
        "memo": asset.memo or "",
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }
    if include_runs:
        runs = list(
            asset.depreciation_runs.select_related("journal_entry").order_by("-run_date", "-id")[:60]
        )
        data["depreciation_runs"] = [
            {
                "id": r.id,
                "run_date": _ser_date(r.run_date),
                "period_start": _ser_date(r.period_start),
                "period_end": _ser_date(r.period_end),
                "amount": str(r.amount),
                "memo": r.memo or "",
                "journal_entry_id": r.journal_entry_id,
                "reversed_at": r.reversed_at.isoformat() if r.reversed_at else None,
                "reversal_journal_entry_id": r.reversal_journal_entry_id,
            }
            for r in runs
        ]
    return data


def _load_asset(cid: int, asset_id: int, *, include_runs: bool = False) -> FixedAsset | None:
    qs = FixedAsset.objects.filter(id=asset_id, company_id=cid).select_related(
        "station", "aquaculture_pond", "asset_account", "accumulated_depreciation_account", "depreciation_expense_account"
    )
    if include_runs:
        qs = qs.prefetch_related("depreciation_runs")
    return qs.first()


def _resolve_coa_by_code(cid: int, code: str, account_type: str | None = None) -> ChartOfAccount | None:
    qs = ChartOfAccount.objects.filter(company_id=cid, account_code=code, is_active=True)
    if account_type:
        qs = qs.filter(account_type=account_type)
    return qs.order_by("id").first()


def _entity_tag_required(stn_id, pond_id, company_wide: bool = False) -> JsonResponse | None:
    if company_wide:
        return None
    if not stn_id and not pond_id:
        return JsonResponse(
            {
                "detail": (
                    "station_id or aquaculture_pond_id is required "
                    "(depreciation expense must tag an entity for P&L)."
                )
            },
            status=400,
        )
    return None


def _parse_entity_tags(cid: int, body: dict) -> tuple[int | None, int | None, JsonResponse | None]:
    stn_id = None
    if "station_id" in body or "station" in body:
        raw_s = body.get("station_id", body.get("station"))
        if raw_s not in (None, "", 0, "0"):
            pv = parse_valid_station_id(cid, raw_s)
            if pv is None:
                return None, None, JsonResponse(
                    {"detail": "Unknown, inactive, or invalid station_id for this company."},
                    status=400,
                )
            stn_id = pv
    pond_id = None
    if "aquaculture_pond_id" in body or "pond_id" in body:
        raw_p = body.get("aquaculture_pond_id", body.get("pond_id"))
        if raw_p not in (None, "", 0, "0"):
            try:
                pond_id = int(raw_p)
            except (TypeError, ValueError):
                return None, None, JsonResponse({"detail": "Invalid aquaculture_pond_id"}, status=400)
            if not AquaculturePond.objects.filter(id=pond_id, company_id=cid, is_active=True).exists():
                return None, None, JsonResponse({"detail": "Valid aquaculture_pond_id required"}, status=400)
    return stn_id, pond_id, None


def _validate_coa_set(cid: int, body: dict, *, require_all: bool) -> JsonResponse | None:
    try:
        aa = _parse_required_positive_int(body.get("asset_account_id"), "asset_account_id") if require_all or body.get("asset_account_id") else _parse_optional_positive_int(body.get("asset_account_id"), "asset_account_id")
        ad = _parse_required_positive_int(body.get("accumulated_depreciation_account_id"), "accumulated_depreciation_account_id") if require_all or body.get("accumulated_depreciation_account_id") else _parse_optional_positive_int(body.get("accumulated_depreciation_account_id"), "accumulated_depreciation_account_id")
        de = _parse_required_positive_int(body.get("depreciation_expense_account_id"), "depreciation_expense_account_id") if require_all or body.get("depreciation_expense_account_id") else _parse_optional_positive_int(body.get("depreciation_expense_account_id"), "depreciation_expense_account_id")
        sa = _parse_optional_positive_int(body.get("settlement_account_id"), "settlement_account_id")
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)

    for aid, validator, label in (
        (aa, _validate_asset_account, "asset_account_id"),
        (ad, _validate_accum_account, "accumulated_depreciation_account_id"),
        (de, _validate_expense_account, "depreciation_expense_account_id"),
        (sa, _validate_settlement_account, "settlement_account_id"),
    ):
        if aid is None:
            continue
        if not _coa_belongs(cid, aid):
            return JsonResponse({"detail": f"Invalid {label}"}, status=400)
        acc = ChartOfAccount.objects.filter(id=aid, company_id=cid).first()
        if acc and not validator(acc):
            return JsonResponse({"detail": f"{label} has wrong account type for fixed assets"}, status=400)
    return None


@csrf_exempt
@auth_required
@require_company_id
def fixed_assets_list_or_create(request):
    cid = request.company_id
    if request.method == "GET":
        qs = (
            FixedAsset.objects.filter(company_id=cid)
            .select_related("station", "aquaculture_pond")
            .order_by("-created_at", "-id")
        )
        status = (request.GET.get("status") or "").strip()
        if status:
            qs = qs.filter(status=status)
        return JsonResponse([_asset_json(x) for x in qs], safe=False)

    if request.method == "POST":
        body, err = parse_json_body(request)
        if err:
            return err
        coa_err = _validate_coa_set(cid, body, require_all=True)
        if coa_err:
            return coa_err
        stn_id, pond_id, tag_err = _parse_entity_tags(cid, body)
        if tag_err:
            return tag_err
        company_wide = bool(body.get("company_wide", False))
        if company_wide:
            stn_id, pond_id = None, None
        ent_err = _entity_tag_required(stn_id, pond_id, company_wide)
        if ent_err:
            return ent_err
        cost = _dec(body.get("acquisition_cost"))
        if cost <= 0:
            return JsonResponse({"detail": "acquisition_cost must be positive"}, status=400)
        salvage = _dec(body.get("salvage_value"))
        if salvage < 0 or salvage >= cost:
            return JsonResponse({"detail": "salvage_value must be >= 0 and less than acquisition_cost"}, status=400)
        opening = _dec(body.get("opening_accumulated_depreciation"))
        if opening < 0 or opening >= cost:
            return JsonResponse({"detail": "opening_accumulated_depreciation out of range"}, status=400)
        try:
            months = int(body.get("useful_life_months") or 60)
            months = max(1, min(600, months))
        except (TypeError, ValueError):
            months = 60
        method = (body.get("depreciation_method") or FixedAsset.METHOD_STRAIGHT_LINE).strip()
        if method not in ALLOWED_METHODS:
            return JsonResponse({"detail": "depreciation_method must be straight_line"}, status=400)
        try:
            aa = _parse_required_positive_int(body.get("asset_account_id"), "asset_account_id")
            ad = _parse_required_positive_int(body.get("accumulated_depreciation_account_id"), "accumulated_depreciation_account_id")
            de = _parse_required_positive_int(body.get("depreciation_expense_account_id"), "depreciation_expense_account_id")
            sa = _parse_optional_positive_int(body.get("settlement_account_id"), "settlement_account_id")
        except ValueError as e:
            return JsonResponse({"detail": str(e)}, status=400)

        temp_no = f"TMP-{uuid.uuid4().hex}"[:64]
        user_no, no_err = user_supplied_code_or_auto(
            cid, FixedAsset, "asset_number", "FA", body.get("asset_number"), 5
        )
        if no_err:
            return JsonResponse({"detail": no_err}, status=400)
        try:
            with transaction.atomic():
                asset = FixedAsset.objects.create(
                    company_id=cid,
                    asset_number=user_no or temp_no,
                    name=(body.get("name") or "")[:200] or "Fixed asset",
                    description=body.get("description") or "",
                    status=FixedAsset.STATUS_DRAFT,
                    station_id=stn_id,
                    aquaculture_pond_id=pond_id,
                    company_wide=company_wide,
                    asset_account_id=aa,
                    accumulated_depreciation_account_id=ad,
                    depreciation_expense_account_id=de,
                    settlement_account_id=sa,
                    acquisition_date=_parse_date(body.get("acquisition_date")),
                    in_service_date=_parse_date(body.get("in_service_date")),
                    acquisition_cost=cost,
                    salvage_value=salvage,
                    useful_life_months=months,
                    depreciation_method=method,
                    opening_accumulated_depreciation=opening,
                    accumulated_depreciation=Decimal("0"),
                    memo=body.get("memo") or "",
                )
                if not user_no:
                    assigned, aerr = assign_string_code_if_empty(
                        cid,
                        FixedAsset,
                        "asset_number",
                        "FA",
                        asset.pk,
                        body.get("asset_number"),
                        5,
                    )
                    if aerr:
                        raise ValidationError(aerr)
                    asset.asset_number = assigned
                    asset.save(update_fields=["asset_number"])
        except ValidationError as e:
            return JsonResponse({"detail": str(e)}, status=400)
        return JsonResponse(_asset_json(asset), status=201)

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_detail(request, asset_id: int):
    cid = request.company_id
    asset = _load_asset(cid, asset_id, include_runs=True)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return JsonResponse(_asset_json(asset, include_runs=True))

    if request.method == "PUT":
        if asset.status in (FixedAsset.STATUS_DISPOSED, FixedAsset.STATUS_FULLY_DEPRECIATED):
            return JsonResponse({"detail": "Cannot edit disposed or fully depreciated assets"}, status=400)
        body, err = parse_json_body(request)
        if err:
            return err
        coa_err = _validate_coa_set(cid, body, require_all=False)
        if coa_err:
            return coa_err
        stn_id, pond_id, tag_err = _parse_entity_tags(cid, body)
        if tag_err:
            return tag_err
        if "company_wide" in body:
            cw = bool(body.get("company_wide"))
            asset.company_wide = cw
            if cw:
                asset.station_id = None
                asset.aquaculture_pond_id = None
        if stn_id is not None or "station_id" in body or "station" in body:
            if not asset.company_wide:
                asset.station_id = stn_id
        if pond_id is not None or "aquaculture_pond_id" in body or "pond_id" in body:
            if not asset.company_wide:
                asset.aquaculture_pond_id = pond_id
        if "name" in body:
            asset.name = (body.get("name") or "")[:200] or asset.name
        if "description" in body:
            asset.description = body.get("description") or ""
        if "memo" in body:
            asset.memo = body.get("memo") or ""
        for field, key in (
            ("asset_account_id", "asset_account_id"),
            ("accumulated_depreciation_account_id", "accumulated_depreciation_account_id"),
            ("depreciation_expense_account_id", "depreciation_expense_account_id"),
            ("settlement_account_id", "settlement_account_id"),
        ):
            if key in body:
                try:
                    val = _parse_optional_positive_int(body.get(key), key)
                except ValueError as e:
                    return JsonResponse({"detail": str(e)}, status=400)
                setattr(asset, field, val)
        if "acquisition_cost" in body:
            cost = _dec(body.get("acquisition_cost"))
            if cost <= 0:
                return JsonResponse({"detail": "acquisition_cost must be positive"}, status=400)
            asset.acquisition_cost = cost
        if "salvage_value" in body:
            asset.salvage_value = _dec(body.get("salvage_value"))
        if "useful_life_months" in body:
            try:
                asset.useful_life_months = max(1, min(600, int(body.get("useful_life_months"))))
            except (TypeError, ValueError):
                return JsonResponse({"detail": "Invalid useful_life_months"}, status=400)
        if "opening_accumulated_depreciation" in body and asset.status == FixedAsset.STATUS_DRAFT:
            asset.opening_accumulated_depreciation = _dec(body.get("opening_accumulated_depreciation"))
        if "acquisition_date" in body:
            asset.acquisition_date = _parse_date(body.get("acquisition_date"))
        if "in_service_date" in body:
            asset.in_service_date = _parse_date(body.get("in_service_date"))
        asset.save()
        asset.refresh_from_db()
        return JsonResponse(_asset_json(asset))

    if request.method == "DELETE":
        if asset.status != FixedAsset.STATUS_DRAFT:
            return JsonResponse({"detail": "Only draft assets can be deleted"}, status=400)
        if asset.depreciation_runs.exists():
            return JsonResponse({"detail": "Asset has depreciation history"}, status=400)
        asset.delete()
        return JsonResponse({"ok": True})

    return JsonResponse({"detail": "Method not allowed"}, status=405)


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_place_in_service(request, asset_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    asset = _load_asset(cid, asset_id)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)
    if asset.status != FixedAsset.STATUS_DRAFT:
        return JsonResponse({"detail": "Asset must be in draft status"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    in_service = _parse_date(body.get("in_service_date")) or asset.in_service_date or timezone.localdate()
    post_acq = bool(body.get("post_acquisition_gl", bool(asset.settlement_account_id)))
    opening = asset.opening_accumulated_depreciation or Decimal("0")
    if opening > 0 and post_acq and asset.settlement_account_id:
        return JsonResponse(
            {
                "detail": (
                    "Mid-life adoption with opening_accumulated_depreciation cannot also post acquisition GL. "
                    "Clear settlement_account or set post_acquisition_gl to false."
                )
            },
            status=400,
        )
    if not asset.station_id and not asset.aquaculture_pond_id and not getattr(asset, "company_wide", False):
        return JsonResponse(
            {
                "detail": (
                    "Set station_id or aquaculture_pond_id before placing in service "
                    "(depreciation expense must tag an entity for P&L)."
                )
            },
            status=400,
        )
    try:
        with transaction.atomic():
            asset.in_service_date = in_service
            asset.status = FixedAsset.STATUS_ACTIVE
            asset.accumulated_depreciation = asset.opening_accumulated_depreciation or Decimal("0")
            asset.save(
                update_fields=[
                    "in_service_date",
                    "status",
                    "accumulated_depreciation",
                    "updated_at",
                ]
            )
            if post_acq and asset.settlement_account_id:
                if not post_fixed_asset_acquisition(cid, asset):
                    raise ValidationError("Acquisition GL posting failed")
            if opening > 0 and not post_fixed_asset_opening_accumulated_depreciation(cid, asset):
                raise ValidationError(
                    "Opening accumulated depreciation GL failed; ensure account 3200 Opening Balance Equity exists"
                )
            asset.refresh_from_db()
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse(_asset_json(asset))


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_depreciate(request, asset_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    asset = _load_asset(cid, asset_id)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)
    if asset.status != FixedAsset.STATUS_ACTIVE:
        return JsonResponse({"detail": "Asset must be active"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    run_date = _parse_date(body.get("run_date")) or timezone.localdate()
    if run_exists_for_period(asset, run_date):
        return JsonResponse({"detail": "Depreciation already posted for this calendar month"}, status=400)
    if body.get("amount") not in (None, ""):
        amt = _dec(body.get("amount"))
    else:
        amt = amount_for_next_run(asset)
    if amt <= Decimal("0.005"):
        return JsonResponse({"detail": "Nothing left to depreciate"}, status=400)
    memo = (body.get("memo") or "")[:500]
    post_gl = bool(body.get("post_to_gl", True))
    try:
        with transaction.atomic():
            run = FixedAssetDepreciationRun.objects.create(
                fixed_asset=asset,
                run_date=run_date,
                period_start=_parse_date(body.get("period_start")),
                period_end=_parse_date(body.get("period_end")) or run_date,
                amount=amt,
                memo=memo,
            )
            if post_gl and not post_fixed_asset_depreciation(cid, run):
                raise ValidationError("Depreciation GL posting failed")
            run.refresh_from_db()
            asset.refresh_from_db()
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse(
        {
            "run": {
                "id": run.id,
                "run_date": _ser_date(run.run_date),
                "amount": str(run.amount),
                "journal_entry_id": run.journal_entry_id,
            },
            "asset": _asset_json(asset),
        },
        status=201,
    )


@csrf_exempt
@auth_required
@require_company_id
def fixed_assets_depreciate_batch(request):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    body, err = parse_json_body(request)
    if err:
        return err
    run_date = _parse_date(body.get("run_date")) or timezone.localdate()
    post_gl = bool(body.get("post_to_gl", True))
    assets = list(
        FixedAsset.objects.filter(company_id=cid, status=FixedAsset.STATUS_ACTIVE).order_by("id")
    )
    posted = []
    skipped = []
    errors = []
    for asset in assets:
        if run_exists_for_period(asset, run_date):
            skipped.append({"asset_id": asset.id, "asset_number": asset.asset_number, "reason": "already_run"})
            continue
        amt = amount_for_next_run(asset)
        if amt <= Decimal("0.005"):
            skipped.append({"asset_id": asset.id, "asset_number": asset.asset_number, "reason": "fully_depreciated"})
            continue
        try:
            with transaction.atomic():
                run = FixedAssetDepreciationRun.objects.create(
                    fixed_asset=asset,
                    run_date=run_date,
                    period_end=run_date,
                    amount=amt,
                    memo=(body.get("memo") or f"Batch depreciation {run_date.isoformat()}")[:500],
                )
                if post_gl and not post_fixed_asset_depreciation(cid, run):
                    raise ValidationError("GL posting failed")
                posted.append({"asset_id": asset.id, "asset_number": asset.asset_number, "amount": str(amt), "run_id": run.id})
        except ValidationError as e:
            errors.append({"asset_id": asset.id, "asset_number": asset.asset_number, "detail": str(e)})
    return JsonResponse(
        {
            "run_date": _ser_date(run_date),
            "posted_count": len(posted),
            "posted": posted,
            "skipped": skipped,
            "errors": errors,
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_schedule(request, asset_id: int):
    if request.method != "GET":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    asset = _load_asset(cid, asset_id)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)
    return JsonResponse(
        {
            "asset_id": asset.id,
            "asset_number": asset.asset_number,
            "schedule": depreciation_schedule(asset),
            "standard_monthly_depreciation": str(standard_monthly_amount(asset)),
            "book_value": str(book_value(asset)),
        }
    )


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_depreciation_reverse(request, asset_id: int, run_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    asset = _load_asset(cid, asset_id)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)
    run = FixedAssetDepreciationRun.objects.filter(id=run_id, fixed_asset_id=asset.id).first()
    if not run:
        return JsonResponse({"detail": "Depreciation run not found"}, status=404)
    if run.reversed_at:
        return JsonResponse({"detail": "Already reversed"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    reversal_date = _parse_date(body.get("reversal_date")) or timezone.localdate()
    try:
        with transaction.atomic():
            if not reverse_fixed_asset_depreciation(cid, run, reversal_date):
                raise ValidationError("Depreciation reversal GL posting failed")
            run.refresh_from_db()
            asset.refresh_from_db()
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse({"run_id": run.id, "asset": _asset_json(asset, include_runs=True)})


@csrf_exempt
@auth_required
@require_company_id
def fixed_asset_dispose(request, asset_id: int):
    if request.method != "POST":
        return JsonResponse({"detail": "Method not allowed"}, status=405)
    cid = request.company_id
    asset = _load_asset(cid, asset_id)
    if not asset:
        return JsonResponse({"detail": "Not found"}, status=404)
    if asset.status not in (FixedAsset.STATUS_ACTIVE, FixedAsset.STATUS_FULLY_DEPRECIATED):
        return JsonResponse({"detail": "Only active or fully depreciated assets can be disposed"}, status=400)
    if asset.disposal_journal_entry_id:
        return JsonResponse({"detail": "Asset already disposed"}, status=400)
    body, err = parse_json_body(request)
    if err:
        return err
    disposal_date = _parse_date(body.get("disposal_date")) or timezone.localdate()
    proceeds = _dec(body.get("proceeds_amount"))
    if proceeds < 0:
        return JsonResponse({"detail": "proceeds_amount cannot be negative"}, status=400)
    try:
        proceeds_acc_id = _parse_optional_positive_int(body.get("proceeds_account_id"), "proceeds_account_id")
        gain_acc_id = _parse_optional_positive_int(body.get("gain_account_id"), "gain_account_id")
        loss_acc_id = _parse_optional_positive_int(body.get("loss_account_id"), "loss_account_id")
    except ValueError as e:
        return JsonResponse({"detail": str(e)}, status=400)

    proceeds_acc = None
    if proceeds > 0:
        if proceeds_acc_id:
            proceeds_acc = ChartOfAccount.objects.filter(id=proceeds_acc_id, company_id=cid, is_active=True).first()
        if not proceeds_acc and asset.settlement_account_id:
            proceeds_acc = ChartOfAccount.objects.filter(
                id=asset.settlement_account_id, company_id=cid, is_active=True
            ).first()
        if not proceeds_acc:
            proceeds_acc = _resolve_coa_by_code(cid, "1030", "bank_account") or _resolve_coa_by_code(cid, "1010", "asset")
        if not proceeds_acc:
            proceeds_acc = (
                ChartOfAccount.objects.filter(company_id=cid, is_active=True, account_type="bank_account")
                .order_by("id")
                .first()
            )
        if not proceeds_acc:
            return JsonResponse({"detail": "proceeds_account_id required when proceeds_amount > 0"}, status=400)

    gain_acc = (
        ChartOfAccount.objects.filter(id=gain_acc_id, company_id=cid, is_active=True).first()
        if gain_acc_id
        else _resolve_coa_by_code(cid, DEFAULT_GAIN_COA_CODE, "income")
    )
    loss_acc = (
        ChartOfAccount.objects.filter(id=loss_acc_id, company_id=cid, is_active=True).first()
        if loss_acc_id
        else _resolve_coa_by_code(cid, DEFAULT_LOSS_COA_CODE, "expense")
    )

    book = book_value(asset)
    gain_loss = proceeds - book
    if gain_loss > Decimal("0.005") and not gain_acc:
        return JsonResponse({"detail": "Gain account required for disposal gain"}, status=400)
    if gain_loss < Decimal("-0.005") and not loss_acc:
        return JsonResponse({"detail": "Loss account required for disposal loss"}, status=400)

    try:
        with transaction.atomic():
            if not post_fixed_asset_disposal(
                cid,
                asset,
                disposal_date=disposal_date,
                proceeds=proceeds,
                proceeds_account=proceeds_acc,
                gain_account=gain_acc,
                loss_account=loss_acc,
            ):
                raise ValidationError("Disposal GL posting failed")
            asset.refresh_from_db()
    except ValidationError as e:
        return JsonResponse({"detail": str(e)}, status=400)
    return JsonResponse(_asset_json(asset))
