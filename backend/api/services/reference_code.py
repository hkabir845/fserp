"""
Reference codes (PREFIX-123).

Two allocators, and the difference matters:

* ``next_available_code`` — **gap-filling**, for master data (customers, vendors, items,
  contracts). Reusing the code of a deleted customer is harmless and keeps codes tidy.
* ``next_sequential_code`` — **monotonic, never reused**, for accounting documents (invoices,
  bills, journal entries). A tax-invoice series must not reissue a number that was used and
  deleted: the number is the audit trail, and two documents that ever shared one cannot be told
  apart afterwards. This allocator also asks the database for ``max(suffix)`` instead of loading
  every row into Python to find a gap, which the gap-filling one has to do — that scan ran on
  every POS sale.
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
    "next_available_code",
    "next_sequential_code",
    "save_with_sequential_code",
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


def collect_used_suffixes(company_id: int | None, model: type, field: str, prefix: str) -> set[int]:
    """Every ``n`` already used as ``PREFIX-n``.

    Finding the lowest free gap genuinely needs the whole set, but it does not need the whole
    table: filter to codes that match the prefix and pull the single column as values, rather
    than instantiating a model object per row in the company.
    """
    qs = model.objects.all()
    if company_id is not None:
        qs = qs.filter(company_id=company_id)
    # iregex, not regex: parse_suffix matches case-insensitively, so a stored "bill-2"
    # counts as suffix 2. A case-sensitive filter would miss it and hand out a code that
    # is already taken.
    qs = qs.filter(**{f"{field}__iregex": r"^" + re.escape(prefix) + r"-[0-9]+$"})
    used: set[int] = set()
    for val in qs.values_list(field, flat=True).iterator(chunk_size=5000):
        n = parse_suffix(str(val or ""), prefix)
        if n is not None:
            used.add(n)
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
    company_id: int | None,
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
    qs = model.objects.filter(**{f"{field}__exact": val})
    if company_id is not None:
        qs = qs.filter(company_id=company_id)
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return not qs.exists()


def next_available_code(
    company_id: int | None,
    model: type,
    field: str,
    prefix: str,
    width: int | None = None,
) -> str:
    """Lowest unused PREFIX-n suffix in ascending order (reuses gaps after deletes)."""
    used = collect_used_suffixes(company_id, model, field, prefix)
    n = first_free_suffix(used)
    for _ in range(10000):
        code = format_code(prefix, n, width)
        if is_code_available(company_id, model, field, prefix, code, None):
            return code
        n += 1
    raise ValueError("Could not assign a free reference code.")


def highest_used_suffix(company_id: int | None, model: type, field: str, prefix: str) -> int:
    """``max(n)`` over ``PREFIX-n`` codes, computed in the database.

    ``collect_used_suffixes`` pulls every row of the table into Python to find gaps. On the
    document tables that is the whole sales history, re-read on every new document.
    """
    from django.db.models import IntegerField, Max
    from django.db.models.functions import Cast, Substr

    qs = model.objects.all()
    if company_id is not None:
        qs = qs.filter(company_id=company_id)
    # Only well-formed PREFIX-<digits> codes; anything else would break the cast.
    qs = qs.filter(**{f"{field}__iregex": r"^" + re.escape(prefix) + r"-[0-9]+$"})
    agg = qs.annotate(
        _suffix=Cast(Substr(field, len(prefix) + 2), IntegerField())
    ).aggregate(m=Max("_suffix"))
    return int(agg["m"] or 0)


def next_sequential_code(
    company_id: int | None,
    model: type,
    field: str,
    prefix: str,
    width: int | None = None,
) -> str:
    """The next number in the series: ``max(used) + 1``, never a reused gap.

    For accounting documents. See the module docstring for why gaps are not filled here.
    """
    n = highest_used_suffix(company_id, model, field, prefix) + 1
    for _ in range(10000):
        code = format_code(prefix, n, width)
        if is_code_available(company_id, model, field, prefix, code, None):
            return code
        n += 1
    raise ValueError("Could not assign a free reference code.")


def save_with_sequential_code(
    instance,
    *,
    company_id: int | None,
    model: type,
    field: str,
    prefix: str,
    width: int | None = None,
    attempts: int = 5,
):
    """Assign the next code and save, retrying when a concurrent insert takes it first.

    ``next_sequential_code`` is a read of ``max(suffix)`` followed by an insert, so two callers
    in the same moment can pick the same number. The database now refuses that (the unique
    constraint on the document number), which is the correct outcome — but an uncaught
    ``IntegrityError`` reaches the user as a 500. Retrying re-reads the maximum and takes the
    next free number, which is what the caller wanted.

    Each attempt runs in its own savepoint so a failed insert does not poison an outer
    transaction. Mirrors the recovery already built into ``gl_posting._create_posted_entry``.
    """
    from django.db import IntegrityError, transaction

    last: Exception | None = None
    for _ in range(max(1, attempts)):
        setattr(instance, field, next_sequential_code(company_id, model, field, prefix, width))
        try:
            with transaction.atomic():
                instance.save()
            return instance
        except IntegrityError as exc:
            last = exc
            instance.pk = None
    raise last if last is not None else RuntimeError("could not assign a document number")


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
