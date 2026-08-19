"""
Example account names offered when creating a chart account, grouped by account type.

This is the data behind the "Select from Examples" picker on the New Account form: pick the
account type, and the picker lists the accounts a business of this kind normally keeps, so the
user names the account from a known-good list instead of inventing a name (and a code) that the
GL automation will not recognise.

Examples are harvested from the built-in charts the posting engine already relies on - the fuel
station template and the aquaculture seed - so choosing one lands on the code that AUTO-* journals
look up. Anything already in the company's chart is flagged so the picker can show it as added.
"""
from __future__ import annotations

from typing import Any, Iterable

from api.services.coa_constants import CHART_ACCOUNT_TYPES, normalize_chart_account_type

# Numeric bands each account type is numbered in, matching the built-in templates
# (1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx COGS, 6xxx expense).
# User-created accounts start high in the band so they do not collide with template codes.
_TYPE_CODE_BAND: dict[str, tuple[int, int]] = {
    "asset": (1000, 1999),
    "bank_account": (1000, 1999),
    "liability": (2000, 2999),
    "equity": (3000, 3999),
    "income": (4000, 4999),
    "cost_of_goods_sold": (5000, 5999),
    "expense": (6000, 6999),
}

_USER_BAND_OFFSET = 900  # first user-created code in a band, e.g. 6900 for expenses


def _loan_band(account_sub_type: str | None) -> tuple[int, int]:
    """Loans are numbered with the side of the balance sheet they sit on."""
    return (2000, 2999) if (account_sub_type or "").strip().lower() == "loan_payable" else (1000, 1999)


def code_band_for(account_type: str, account_sub_type: str | None = None) -> tuple[int, int]:
    t = normalize_chart_account_type(account_type)
    if t == "loan":
        return _loan_band(account_sub_type)
    return _TYPE_CODE_BAND.get(t, (9000, 9999))


def _template_rows() -> Iterable[dict[str, Any]]:
    """Every built-in chart row, from both templates, in one shape."""
    from api.chart_templates.fuel_station import get_fuel_station_rows
    from api.services.aquaculture_coa_seed import AQUACULTURE_COA_ROWS

    for r in get_fuel_station_rows("full"):
        yield {
            "account_code": r["account_code"],
            "account_name": r["account_name"],
            "account_type": r["account_type"],
            "account_sub_type": r.get("account_sub_type") or "",
            "description": r.get("description") or "",
            "source": "fuel_station",
        }
    for code, name, acc_type, sub_type, desc in AQUACULTURE_COA_ROWS:
        yield {
            "account_code": code,
            "account_name": name,
            "account_type": acc_type,
            "account_sub_type": sub_type or "",
            "description": desc or "",
            "source": "aquaculture",
        }


def coa_examples_for_type(company_id: int, account_type: str) -> dict[str, Any]:
    """
    Example accounts for one account type, with the codes already taken by this company marked.

    Returns ``{"account_type", "examples": [...], "next_available_code"}``. Each example carries
    the template's code, sub-type and description so picking one fills the whole form.
    """
    from api.models import ChartOfAccount

    t = normalize_chart_account_type(account_type)
    if t not in CHART_ACCOUNT_TYPES:
        raise ValueError(
            f"Invalid account_type '{account_type}'. Use one of: {', '.join(sorted(CHART_ACCOUNT_TYPES))}."
        )

    existing = {
        (row["account_code"] or "").strip(): (row["account_name"] or "").strip()
        for row in ChartOfAccount.objects.filter(company_id=company_id).values(
            "account_code", "account_name"
        )
    }
    existing_names = {n.strip().lower() for n in existing.values() if n}

    seen_names: set[str] = set()
    examples: list[dict[str, Any]] = []
    for row in _template_rows():
        if normalize_chart_account_type(row["account_type"]) != t:
            continue
        key = row["account_name"].strip().lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        code = (row["account_code"] or "").strip()
        examples.append(
            {
                "account_code": code,
                "account_name": row["account_name"],
                "account_sub_type": row["account_sub_type"],
                "description": row["description"],
                "source": row["source"],
                # True when this company already has the code, or an account by the same name.
                "already_in_chart": code in existing or key in existing_names,
            }
        )

    examples.sort(key=lambda r: r["account_code"])
    return {
        "account_type": t,
        "examples": examples,
        "next_available_code": next_available_account_code(company_id, t),
    }


def next_available_account_code(
    company_id: int, account_type: str, account_sub_type: str | None = None
) -> str:
    """
    First unused code in this account type's band, starting above the built-in template range.

    The GL automation resolves accounts by code, so a user-created account must not land on a
    code a built-in template expects (1010 cash, 2000 A/P, 4200 shop sales, ...). Starting at
    band+900 keeps user accounts clear of the seeded ranges; if that fills up the search falls
    back to any free slot in the band.
    """
    from api.models import ChartOfAccount

    low, high = code_band_for(account_type, account_sub_type)
    taken = {
        (c or "").strip()
        for c in ChartOfAccount.objects.filter(company_id=company_id).values_list(
            "account_code", flat=True
        )
    }
    # Template codes count as taken even when this company has not seeded them yet.
    taken |= {r["account_code"] for r in _template_rows()}

    for n in range(low + _USER_BAND_OFFSET, high + 1):
        if str(n) not in taken:
            return str(n)
    for n in range(low, high + 1):
        if str(n) not in taken:
            return str(n)
    # Band exhausted (thousands of accounts): fall back to a suffixed code that stays unique.
    n = low + _USER_BAND_OFFSET
    while f"{n}-{len(taken)}" in taken:
        n += 1
    return f"{n}-{len(taken)}"
