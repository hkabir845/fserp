"""Unit tests for shared transaction list/statement filters."""
from __future__ import annotations

from api.utils.transaction_filters import (
    filter_json_transactions_by_column,
    filter_json_transactions,
)


def test_filter_json_transactions_by_column_reference():
    rows = [
        {"entry_number": "AUTO-PAY-12-RCV", "description": "Cash receipt"},
        {"entry_number": "AUTO-BILL-5", "description": "Vendor bill"},
    ]
    out = filter_json_transactions_by_column(rows, "reference", "PAY-12")
    assert len(out) == 1
    assert out[0]["entry_number"] == "AUTO-PAY-12-RCV"


def test_filter_json_transactions_free_text():
    rows = [
        {"entry_number": "JE-1", "description": "Office rent", "journal_description": ""},
        {"entry_number": "JE-2", "description": "Fuel sale", "journal_description": ""},
    ]
    out = filter_json_transactions(rows, "rent")
    assert len(out) == 1
    assert out[0]["entry_number"] == "JE-1"
