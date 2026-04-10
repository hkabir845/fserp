"""Islamic financing: terminology flags (GL mechanics stay identical to conventional loans)."""
from __future__ import annotations

from api.models import Loan


def loan_uses_islamic_terminology(lo: Loan) -> bool:
    """
    True when UI and journal memos should use Islamic wording (profit / financing / return).

    Triggered by banking_model=islamic or Islamic facility/deal product types (even if mis-set,
    deal rows are always presented as Islamic financing).
    """
    bm = (lo.banking_model or Loan.BANKING_CONVENTIONAL).strip().lower()
    if bm == Loan.BANKING_ISLAMIC:
        return True
    pt = lo.product_type or Loan.PRODUCT_GENERAL
    return pt in (Loan.PRODUCT_ISLAMIC_FACILITY, Loan.PRODUCT_ISLAMIC_DEAL)
