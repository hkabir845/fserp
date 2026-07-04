"""Parse calendar dates from Brain questions (English, Banglish, Bengali numerals)."""
from __future__ import annotations

import re
from datetime import date

_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

_MONTHS: dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
    "জানুয়ারি": 1,
    "জানু": 1,
    "ফেব্রুয়ারি": 2,
    "ফেব": 2,
    "মার্চ": 3,
    "এপ্রিল": 4,
    "মে": 5,
    "জুন": 6,
    "জুলাই": 7,
    "আগস্ট": 8,
    "আগ": 8,
    "সেপ্টেম্বর": 9,
    "অক্টোবর": 10,
    "অক্ট": 10,
    "নভেম্বর": 11,
    "নভ": 11,
    "ডিসেম্বর": 12,
    "ডিস": 12,
}

_ORDINAL_SUFFIX = r"(?:st|nd|rd|th|ই|য়|ষ্ঠ)?"


def _norm(text: str) -> str:
    return (text or "").translate(_BN_DIGITS).lower().strip()


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _infer_year(month: int, day: int, today: date) -> int:
    """Pick the most recent year that is not in the future (same month/day)."""
    candidate = _safe_date(today.year, month, day)
    if candidate and candidate <= today:
        return today.year
    return today.year - 1


def _parse_day_month_year(day: int, month: int, year: int | None, today: date) -> date | None:
    y = year if year is not None else _infer_year(month, day, today)
    return _safe_date(y, month, day)


def _month_pattern() -> str:
    return "|".join(re.escape(k) for k in sorted(_MONTHS.keys(), key=len, reverse=True))


def try_parse_date_range(message: str, today: date) -> tuple[date, date] | None:
    """Explicit ranges: '1 to 5 july', 'july 1-5', '1st to 5th july 2026'."""
    text = _norm(message)
    if not text:
        return None

    month_pat = _month_pattern()

    # 1 to 5 july [2026]
    m = re.search(
        rf"\b(\d{{1,2}}){_ORDINAL_SUFFIX}\s*(?:to|–|-|—|theke|থেকে)\s*(\d{{1,2}}){_ORDINAL_SUFFIX}\s+({month_pat})(?:\s+(\d{{4}}))?\b",
        text,
        re.I,
    )
    if m:
        d1, d2, mon, yr = int(m.group(1)), int(m.group(2)), _MONTHS[m.group(3).lower()], m.group(4)
        year = int(yr) if yr else _infer_year(mon, max(d1, d2), today)
        start = _safe_date(year, mon, d1)
        end = _safe_date(year, mon, d2)
        if start and end:
            return (start, end) if start <= end else (end, start)

    # july 1 to 5 [2026]
    m = re.search(
        rf"\b({month_pat})\s+(\d{{1,2}}){_ORDINAL_SUFFIX}\s*(?:to|–|-|—|theke|থেকে)\s*(\d{{1,2}}){_ORDINAL_SUFFIX}(?:\s+(\d{{4}}))?\b",
        text,
        re.I,
    )
    if m:
        mon, d1, d2, yr = _MONTHS[m.group(1).lower()], int(m.group(2)), int(m.group(3)), m.group(4)
        year = int(yr) if yr else _infer_year(mon, max(d1, d2), today)
        start = _safe_date(year, mon, d1)
        end = _safe_date(year, mon, d2)
        if start and end:
            return (start, end) if start <= end else (end, start)

    return None


def try_parse_specific_date(message: str, today: date) -> date | None:
    """Single calendar day: '4th july', 'july 4 2026', '2026-07-04', '৪ জুলাই'."""
    text = _norm(message)
    if not text:
        return None

    # ISO YYYY-MM-DD
    m = re.search(r"\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b", text)
    if m:
        return _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

    # DD/MM/YYYY or DD-MM-YYYY (day-first — Bangladesh)
    m = re.search(r"\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2})\b", text)
    if m:
        return _parse_day_month_year(int(m.group(1)), int(m.group(2)), int(m.group(3)), today)

    month_pat = _month_pattern()

    # 4th july [2026] | 4 july
    m = re.search(
        rf"\b(\d{{1,2}}){_ORDINAL_SUFFIX}\s+({month_pat})(?:\s+(20\d{{2}}))?\b",
        text,
        re.I,
    )
    if m:
        return _parse_day_month_year(int(m.group(1)), _MONTHS[m.group(2).lower()], int(m.group(3)) if m.group(3) else None, today)

    # july 4th [2026] | july 4
    m = re.search(
        rf"\b({month_pat})\s+(\d{{1,2}}){_ORDINAL_SUFFIX}(?:\s+(20\d{{2}}))?\b",
        text,
        re.I,
    )
    if m:
        return _parse_day_month_year(int(m.group(2)), _MONTHS[m.group(1).lower()], int(m.group(3)) if m.group(3) else None, today)

    # DD/MM or DD-MM without year (day-first)
    m = re.search(r"\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])\b", text)
    if m:
        return _parse_day_month_year(int(m.group(1)), int(m.group(2)), None, today)

    return None


def resolve_question_period(message: str, today: date) -> tuple[date, date, str] | None:
    """
    Return (start, end, label) when the message names a specific day or range.
    None → caller should apply relative defaults (today, MTD, etc.).
    """
    rng = try_parse_date_range(message, today)
    if rng:
        start, end = rng
        if start == end:
            return start, end, "specific_date"
        return start, end, "date_range"

    one = try_parse_specific_date(message, today)
    if one:
        return one, one, "specific_date"

    return None
