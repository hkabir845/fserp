"""Server-side validation for bill_purpose (station / pond / office / mixed) on vendor bills."""
from __future__ import annotations

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


def infer_bill_purpose_from_parsed_lines(parsed_lines: list[dict]) -> str:
    """When the client omits bill_purpose, infer from expanded line tags."""
    has_pond = False
    has_station = False
    for pl in parsed_lines:
        if pl.get("aquaculture_pond_id"):
            has_pond = True
        if (pl.get("fuel_station_expense_category") or "").strip():
            has_station = True
        if pl.get("receipt_station_id"):
            has_station = True
    if has_pond and has_station:
        return "mixed"
    if has_pond:
        return "pond"
    if has_station:
        return "station"
    return "station"


def _line_has_pond_tag(pl: dict) -> bool:
    return bool(pl.get("aquaculture_pond_id"))


def _line_has_station_tag(pl: dict) -> bool:
    if (pl.get("fuel_station_expense_category") or "").strip():
        return True
    return bool(pl.get("receipt_station_id"))


def validate_parsed_lines_for_bill_purpose(
    purpose: str,
    parsed_lines: list[dict],
) -> str | None:
    """Validate expanded bill line dicts against the declared bill purpose."""
    if purpose == "mixed":
        for i, pl in enumerate(parsed_lines, start=1):
            if _line_has_pond_tag(pl) and _line_has_station_tag(pl):
                return (
                    f"Line {i}: cannot tag both a pond and a station on the same line."
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
        if pl.get("receipt_station_id") and purpose == "office":
            return f"Line {i}: office bills cannot tag a receiving station on a line."
    return None
