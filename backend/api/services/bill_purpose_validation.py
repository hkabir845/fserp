"""Server-side validation for bill_purpose (station / pond / office / mixed) on vendor bills."""
from __future__ import annotations

from api.services.station_business_kind import station_is_shop_hub

VALID_BILL_PURPOSES = frozenset({"station", "pond", "office", "mixed"})


def parse_bill_purpose(body: dict) -> tuple[str, str | None]:
    """Return (purpose, error_message). Defaults to station when omitted."""
    raw = body.get("bill_purpose")
    if raw is None or str(raw).strip() == "":
        return "station", None
    purpose = str(raw).strip().lower()
    if purpose not in VALID_BILL_PURPOSES:
        return (
            "station",
            f"Unknown bill_purpose: {raw!r}. Use station, pond, office, or mixed.",
        )
    return purpose, None


def infer_bill_purpose_from_parsed_lines(
    parsed_lines: list[dict],
    company_id: int | None = None,
) -> str:
    """When the client omits bill_purpose, infer from expanded line tags."""
    has_pond = False
    has_fuel_station = False
    has_shop = False
    for pl in parsed_lines:
        if pl.get("aquaculture_pond_id") or (pl.get("aquaculture_cost_bucket") or "").strip():
            has_pond = True
        sid = pl.get("receipt_station_id")
        if company_id and sid and station_is_shop_hub(company_id, int(sid)):
            has_shop = True
        elif _line_has_fuel_station_tag(pl, company_id):
            has_fuel_station = True
    if (has_pond or has_shop) and has_fuel_station:
        return "mixed"
    if has_pond or has_shop:
        return "pond"
    if has_fuel_station:
        return "station"
    return "station"


def _line_has_pond_tag(pl: dict) -> bool:
    return bool(pl.get("aquaculture_pond_id"))


def _line_has_fuel_station_tag(pl: dict, company_id: int | None = None) -> bool:
    if (pl.get("fuel_station_expense_category") or "").strip():
        return True
    sid = pl.get("receipt_station_id")
    if not sid:
        return False
    if company_id and station_is_shop_hub(company_id, int(sid)):
        return False
    return True


def _line_has_station_tag(pl: dict, company_id: int | None = None) -> bool:
    return _line_has_fuel_station_tag(pl, company_id)


def validate_parsed_lines_for_bill_purpose(
    purpose: str,
    parsed_lines: list[dict],
    company_id: int | None = None,
) -> str | None:
    """Validate expanded bill line dicts against the declared bill purpose."""
    if purpose == "mixed":
        for i, pl in enumerate(parsed_lines, start=1):
            if _line_has_pond_tag(pl) and _line_has_fuel_station_tag(pl, company_id):
                return (
                    f"Line {i}: cannot tag both a pond and a fuel station on the same line."
                )
            fuel = (pl.get("fuel_station_expense_category") or "").strip()
            if fuel and _line_has_pond_tag(pl):
                return (
                    f"Line {i}: fuel station expense category cannot be used with a pond tag."
                )
        return None

    for i, pl in enumerate(parsed_lines, start=1):
        if _line_has_pond_tag(pl):
            if purpose == "station":
                return f"Line {i}: station bills cannot tag a pond."
            if purpose == "office":
                return f"Line {i}: office bills cannot tag a pond."
        fuel = (pl.get("fuel_station_expense_category") or "").strip()
        if fuel and purpose in ("pond", "office"):
            return (
                f"Line {i}: fuel station expense category is only for station bills."
            )
        sid = pl.get("receipt_station_id")
        if sid and purpose == "office":
            return f"Line {i}: office bills cannot tag a receiving station on a line."
        if (
            company_id
            and sid
            and station_is_shop_hub(company_id, int(sid))
            and purpose == "station"
            and not _line_has_pond_tag(pl)
            and (pl.get("aquaculture_cost_bucket") or "").strip()
        ):
            return (
                f"Line {i}: shop / aquaculture hub purchases belong on pond-purpose bills, "
                "not fuel-station bills."
            )
    return None
