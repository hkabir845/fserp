"""P&L opening balances by income type / expense category per pond."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from api.models import AquaculturePondPlOpening
from api.services.aquaculture_cutover import validate_opening_as_of
from api.services.tenant_reporting_categories import (
    merged_aquaculture_expense_category_list_for_api,
    merged_aquaculture_income_type_list_for_api,
)

_MONEY = Decimal("0.01")
PL_EXPENSE_EXCLUDED_CODES = frozenset({"lease"})


def _q(d: Decimal | None) -> Decimal:
    return (d or Decimal("0")).quantize(_MONEY, rounding=ROUND_HALF_UP)


def category_catalog_for_api(company_id: int) -> dict:
    income = merged_aquaculture_income_type_list_for_api(company_id)
    expense = [
        row
        for row in merged_aquaculture_expense_category_list_for_api(company_id)
        if row.get("id") not in PL_EXPENSE_EXCLUDED_CODES
    ]
    return {
        "income_types": [{"code": r["id"], "label": r.get("label") or r["id"]} for r in income],
        "expense_categories": [
            {"code": r["id"], "label": r.get("label") or r["id"]} for r in expense
        ],
        "expense_excluded": [
            {
                "code": "lease",
                "label": "Lease / landlord",
                "note": "Use Aquaculture → Landlords for rent opening and payments.",
            }
        ],
    }


def _label_for_code(company_id: int, pl_kind: str, code: str) -> str:
    cat = category_catalog_for_api(company_id)
    rows = cat["income_types"] if pl_kind == AquaculturePondPlOpening.KIND_INCOME else cat["expense_categories"]
    for row in rows:
        if row["code"] == code:
            return row["label"]
    return code


def pl_opening_rows_for_pond(company_id: int, pond_id: int) -> dict:
    """Return income/expense opening rows merged with catalog (zeros for unset categories)."""
    cat = category_catalog_for_api(company_id)
    stored = {
        (o.pl_kind, o.category_code): o
        for o in AquaculturePondPlOpening.objects.filter(company_id=company_id, pond_id=pond_id)
    }

    def build_rows(pl_kind: str, catalog: list[dict]) -> list[dict]:
        out: list[dict] = []
        for c in catalog:
            code = c["code"]
            o = stored.get((pl_kind, code))
            amt = _q(o.amount) if o else Decimal("0")
            signed = amt if pl_kind == AquaculturePondPlOpening.KIND_INCOME else -amt
            out.append(
                {
                    "category_code": code,
                    "category_label": c["label"],
                    "amount": str(amt),
                    "as_of_date": o.as_of_date.isoformat() if o and o.as_of_date else None,
                    "memo": (o.memo or "").strip() if o else "",
                    "signed_contribution": str(_q(signed)),
                    "side": "income" if pl_kind == AquaculturePondPlOpening.KIND_INCOME else "expense",
                }
            )
        return out

    income_rows = build_rows(AquaculturePondPlOpening.KIND_INCOME, cat["income_types"])
    expense_rows = build_rows(AquaculturePondPlOpening.KIND_EXPENSE, cat["expense_categories"])
    income_total = sum(_q(Decimal(r["amount"])) for r in income_rows)
    expense_total = sum(_q(Decimal(r["amount"])) for r in expense_rows)
    return {
        "income": income_rows,
        "expense": expense_rows,
        "totals": {
            "income_signed": str(_q(income_total)),
            "expense_signed": str(_q(expense_total)),
            "net_pl_signed": str(_q(income_total - expense_total)),
        },
    }


def pl_opening_totals_for_pond(company_id: int, pond_id: int) -> tuple[Decimal, Decimal, dict[str, Decimal], dict[str, Decimal]]:
    """Return (income_total, expense_total, income_by_code, expense_by_code) for pond analytics."""
    rows = pl_opening_rows_for_pond(company_id, pond_id)
    income_by: dict[str, Decimal] = {}
    expense_by: dict[str, Decimal] = {}
    income_total = Decimal("0")
    expense_total = Decimal("0")
    for r in rows["income"]:
        amt = _q(Decimal(r["amount"]))
        if amt != 0:
            income_by[r["category_code"]] = amt
            income_total += amt
    for r in rows["expense"]:
        amt = _q(Decimal(r["amount"]))
        if amt != 0:
            expense_by[r["category_code"]] = amt
            expense_total += amt
    return income_total, expense_total, income_by, expense_by


def sync_pond_pl_openings(
    company_id: int,
    pond_id: int,
    *,
    income: list[dict] | None = None,
    expense: list[dict] | None = None,
) -> str | None:
    """Upsert P&L openings from API payload lists. Returns error message or None."""

    def apply_rows(pl_kind: str, rows: list[dict] | None, allowed_codes: set[str]) -> str | None:
        if rows is None:
            return None
        if not isinstance(rows, list):
            return f"{pl_kind} must be a list"
        seen: set[str] = set()
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            code = (raw.get("category_code") or raw.get("code") or "").strip()
            if not code:
                continue
            if code not in allowed_codes:
                return f"Unknown category_code for {pl_kind}: {code}"
            if code in seen:
                return f"Duplicate category_code {code} for {pl_kind}"
            seen.add(code)
            amt = _q(Decimal(str(raw.get("amount", 0))))
            as_of = raw.get("as_of_date")
            as_of_d: date | None = None
            if as_of:
                try:
                    as_of_d = date.fromisoformat(str(as_of).split("T")[0])
                except ValueError:
                    return f"Invalid as_of_date for {code}"
            if amt == 0:
                AquaculturePondPlOpening.objects.filter(
                    company_id=company_id,
                    pond_id=pond_id,
                    pl_kind=pl_kind,
                    category_code=code,
                ).delete()
                continue
            if not as_of_d:
                return f"as_of_date required for non-zero {pl_kind} opening ({code})"
            cut_err = validate_opening_as_of(company_id, as_of_d)
            if cut_err:
                return cut_err
            memo = str(raw.get("memo") or "")[:5000]
            AquaculturePondPlOpening.objects.update_or_create(
                company_id=company_id,
                pond_id=pond_id,
                pl_kind=pl_kind,
                category_code=code,
                defaults={"amount": amt, "as_of_date": as_of_d, "memo": memo},
            )
        return None

    cat = category_catalog_for_api(company_id)
    income_codes = {r["code"] for r in cat["income_types"]}
    expense_codes = {r["code"] for r in cat["expense_categories"]}
    err = apply_rows(AquaculturePondPlOpening.KIND_INCOME, income, income_codes)
    if err:
        return err
    err = apply_rows(AquaculturePondPlOpening.KIND_EXPENSE, expense, expense_codes)
    return err
