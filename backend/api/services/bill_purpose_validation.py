"""Server-side validation for bill_purpose (station / pond / office) on vendor bills."""
from __future__ import annotations

VALID_BILL_PURPOSES = frozenset({"station", "pond", "office"})


def parse_bill_purpose(body: dict) -> tuple[str, str | None]:
    """Return (purpose, error_message). Defaults to station when omitted."""
    raw = body.get("bill_purpose")
    if raw is None or str(raw).strip() == "":
        return "station", None
    purpose = str(raw).strip().lower()
    if purpose not in VALID_BILL_PURPOSES:
        return (
            "station",
            f"Unknown bill_purpose: {raw!r}. Use station, pond, or office.",
        )
    return purpose, None


def infer_bill_purpose_from_parsed_lines(parsed_lines: list[dict]) -> str:
    """When the client omits bill_purpose, infer from expanded line tags."""
    for pl in parsed_lines:
        if pl.get("aquaculture_pond_id"):
            return "pond"
        if (pl.get("fuel_station_expense_category") or "").strip():
            return "station"
        if pl.get("receipt_station_id"):
            return "station"
    return "station"


def validate_parsed_lines_for_bill_purpose(
    purpose: str,
    parsed_lines: list[dict],
) -> str | None:
    """Validate expanded bill line dicts against the declared bill purpose."""
    for i, pl in enumerate(parsed_lines, start=1):
        if pl.get("aquaculture_pond_id"):
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
