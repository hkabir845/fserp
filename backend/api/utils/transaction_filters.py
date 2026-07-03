"""Shared list/statement filters for financial transaction views.

When text search is active (``q`` or column filter), date ranges are skipped so
users can find old and new records across the full ledger.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Q, QuerySet


def parse_optional_date_param(val) -> Optional[date]:
    if not val:
        return None
    try:
        return date.fromisoformat(str(val).split("T")[0])
    except Exception:
        return None


def parse_optional_decimal_param(val, default: Decimal = Decimal("0")) -> Decimal:
    if val is None or val == "":
        return default
    try:
        return Decimal(str(val))
    except Exception:
        return default


def request_has_text_search(
    request,
    *,
    q_param: str = "q",
    filter_column_param: str = "filter_column",
    filter_value_param: str = "filter_value",
) -> bool:
    q = (request.GET.get(q_param) or "").strip()
    if q:
        return True
    filter_column = (request.GET.get(filter_column_param) or "").strip().lower()
    filter_value = (request.GET.get(filter_value_param) or "").strip()
    return bool(filter_column and filter_column != "all" and filter_value)


def apply_transaction_date_range(
    qs: QuerySet,
    request,
    date_field: str,
    *,
    has_text_search: bool | None = None,
) -> QuerySet:
    """Apply ``start_date`` / ``end_date`` unless a text search is active."""
    if has_text_search is None:
        has_text_search = request_has_text_search(request)
    if has_text_search:
        return qs
    start = parse_optional_date_param(request.GET.get("start_date"))
    end = parse_optional_date_param(request.GET.get("end_date"))
    if start:
        qs = qs.filter(**{f"{date_field}__gte": start})
    if end:
        qs = qs.filter(**{f"{date_field}__lte": end})
    return qs


def apply_transaction_amount_range(
    qs: QuerySet,
    request,
    amount_field: str,
    *,
    min_param: str = "min_amount",
    max_param: str = "max_amount",
) -> QuerySet:
    min_amount = parse_optional_decimal_param(request.GET.get(min_param))
    max_amount = parse_optional_decimal_param(request.GET.get(max_param))
    if min_amount > 0:
        qs = qs.filter(**{f"{amount_field}__gte": min_amount})
    if max_amount > 0:
        qs = qs.filter(**{f"{amount_field}__lte": max_amount})
    return qs


def filter_json_transactions(transactions: list[dict[str, Any]], q: str) -> list[dict[str, Any]]:
    """Filter ledger/statement row dicts by a free-text query."""
    needle = (q or "").strip().lower()
    if not needle:
        return transactions
    out: list[dict[str, Any]] = []
    for row in transactions:
        hay = " ".join(
            str(row.get(k) or "")
            for k in (
                "reference",
                "description",
                "journal_description",
                "entry_number",
                "type",
                "date",
                "debit",
                "credit",
                "other_account_name",
                "other_account_code",
                "station_name",
                "source_label",
            )
        ).lower()
        if needle in hay:
            out.append(row)
    return out


_STATEMENT_COLUMN_FIELDS: dict[str, tuple[str, ...]] = {
    "date": ("date",),
    "type": ("type", "debit", "credit"),
    "reference": ("reference", "entry_number", "journal_entry_number"),
    "description": ("description", "journal_description"),
    "debit": ("debit", "debit_amount"),
    "credit": ("credit", "credit_amount"),
    "source": ("source_label", "source_type", "entry_number"),
    "other_account": ("other_account_name", "other_account_code"),
}


def filter_json_transactions_by_column(
    transactions: list[dict[str, Any]],
    column: str,
    value: str,
) -> list[dict[str, Any]]:
    """Filter statement rows where ``column`` contains ``value`` (case-insensitive)."""
    col = (column or "").strip().lower()
    needle = (value or "").strip().lower()
    if not col or col == "all" or not needle:
        return transactions
    fields = _STATEMENT_COLUMN_FIELDS.get(col)
    if not fields:
        return transactions
    out: list[dict[str, Any]] = []
    for row in transactions:
        hay = " ".join(str(row.get(k) or "") for k in fields).lower()
        if needle in hay:
            out.append(row)
    return out


def apply_json_transaction_filters(
    transactions: list[dict[str, Any]],
    request,
    *,
    q_param: str = "q",
    filter_column_param: str = "filter_column",
    filter_value_param: str = "filter_value",
) -> list[dict[str, Any]]:
    """Apply free-text ``q`` or column/value filters to in-memory statement rows."""
    q = (request.GET.get(q_param) or "").strip()
    if q:
        return filter_json_transactions(transactions, q)
    column = (request.GET.get(filter_column_param) or "").strip().lower()
    value = (request.GET.get(filter_value_param) or "").strip()
    if column and column != "all" and value:
        return filter_json_transactions_by_column(transactions, column, value)
    return transactions
