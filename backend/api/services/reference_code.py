"""
Gap-aware reference codes (PREFIX-123) for master data.

Autofill picks the lowest free integer suffix. Optional UI can list
gaps through max(used) plus the next number (e.g. if 3 is used: 1, 2, 4).
"""
import re
from typing import Any

__all__ = [
    "parse_suffix",
    "format_code",
    "collect_used_suffixes",
    "first_free_suffix",
    "choice_suffixes",
    "is_code_available",
    "suggest_payload",
    "user_supplied_code_or_auto",
    "assign_string_code_if_empty",
]


def parse_suffix(value: str, prefix: str) -> int | None:
    """Return integer after ``PREFIX-`` or None if the string does not match."""
    s = (value or "").strip()
    if not s:
        return None
    pat = re.compile(r"^" + re.escape(prefix) + r"-(\d+)$", re.IGNORECASE)
    m = pat.match(s)
    if not m:
        return None
    return int(m.group(1))


def format_code(prefix: str, n: int, width: int | None = None) -> str:
    if width is not None and width > 0:
        return f"{prefix}-{n:0{width}d}"
    return f"{prefix}-{n}"


def collect_used_suffixes(company_id: int, model: type, field: str, prefix: str) -> set[int]:
    used: set[int] = set()
    for row in model.objects.filter(company_id=company_id).only("id", field):
        val = getattr(row, field) or ""
        s = parse_suffix(str(val), prefix)
        if s is not None:
            used.add(s)
    return used


def first_free_suffix(used: set[int]) -> int:
    n = 1
    while n in used:
        n += 1
    return n


def choice_suffixes(used: set[int]) -> list[int]:
    """
    Suggested options: every gap from 1..max(used)-1, plus max(used)+1.
    If no rows use this prefix, only [1].
    """
    if not used:
        return [1]
    m = max(used)
    gaps = [i for i in range(1, m) if i not in used]
    return sorted(gaps) + [m + 1]


def is_code_available(
    company_id: int,
    model: type,
    field: str,
    prefix: str,
    code: str,
    exclude_pk: int | None = None,
) -> bool:
    """True if no other row has this exact *field* value (case-sensitive string)."""
    val = (code or "").strip()
    if not val:
        return False
    qs = model.objects.filter(company_id=company_id, **{f"{field}__exact": val})
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return not qs.exists()


def user_supplied_code_or_auto(
    company_id: int,
    model: type,
    field: str,
    prefix: str,
    user_value: str | None,
    width: int | None = None,
) -> tuple[str | None, str | None]:
    """
    For create: if *user_value* is non-empty, return (formatted_code, None) or (None, error).
    If omitted/blank, return (None, None) to run assign_string_code_if_empty after save.
    """
    raw = (user_value or "").strip() if user_value is not None else ""
    if not raw:
        return None, None
    s = parse_suffix(raw, prefix)
    if s is None:
        return None, f"Invalid code; expected {prefix}-<number> (e.g. {prefix}-1)."
    code = format_code(prefix, s, width)
    if not is_code_available(company_id, model, field, prefix, code, None):
        return None, f"Reference code '{code}' is already used in this company."
    return code, None


def suggest_payload(company_id: int, model: type, field: str, prefix: str, width: int | None = None) -> dict[str, Any]:
    used = collect_used_suffixes(company_id, model, field, prefix)
    d = first_free_suffix(used)
    choices = choice_suffixes(used)
    choice_codes = [format_code(prefix, s, width) for s in choices]
    return {
        "prefix": prefix,
        "used_suffixes": sorted(used),
        "choice_suffixes": choices,
        "choice_codes": choice_codes,
        "default_suffix": d,
        "default_code": format_code(prefix, d, width),
    }


def assign_string_code_if_empty(
    company_id: int,
    model: type,
    field: str,
    prefix: str,
    pk: int,
    user_value: str | None,
    width: int | None = None,
) -> tuple[str, str | None]:
    """
    For a newly saved row with pk, set *field* from user_value or first free.
    Returns (value_written, error_detail or None).
    """
    raw = (user_value or "").strip() if user_value is not None else ""
    if raw:
        s = parse_suffix(raw, prefix)
        if s is None:
            return "", f"Invalid code; expected {prefix}-<number> (e.g. {prefix}-1)."
        code = format_code(prefix, s, width)
        if not is_code_available(company_id, model, field, prefix, code, exclude_pk=pk):
            return "", f"Reference code '{code}' is already used in this company."
        model.objects.filter(pk=pk, company_id=company_id).update(**{field: code})
        return code, None
    used = collect_used_suffixes(company_id, model, field, prefix)
    n = first_free_suffix(used)
    for _ in range(10000):
        code = format_code(prefix, n, width)
        if is_code_available(company_id, model, field, prefix, code, exclude_pk=pk):
            model.objects.filter(pk=pk, company_id=company_id).update(**{field: code})
            return code, None
        n += 1
    return "", "Could not assign a free reference code."
