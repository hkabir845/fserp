"""
Locked aquaculture accounting policy (management + GL).

Adopted 2026-09-24 after world-benchmark research (IAS 41 / Mowi–SalMar / MAS 5 /
pond transfer-pricing). These are **policy** choices — not audit defects.

Model A (profit-centre nursing): each pond is a profit centre; IPT sale =
cost/kg + company margin/kg; nursing surplus is accepted; consolidation
eliminates unrealized inter-pond margin until external harvest.

See docs/AQUACULTURE_ACCOUNTING_POLICY.md.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

MONEY_Q = Decimal("0.01")
RATIO_Q = Decimal("0.0001")

# --- Nursing / IPT ---------------------------------------------------------
NURSING_MODEL = "profit_centre"  # Model A; alternative would be "cost_centre"
NURSING_SURPLUS_POLICY = (
    "Accepted: nursing ponds are profit centres. IPT income may exceed expense. "
    "Do not run reconcile_nursing_pond_pl_balance apply to chase zero net. "
    "Use reconcile only for nursing *deficit* (expense ≫ income) after first transfer-out."
)

# --- Bio-cap (1581 relief) -------------------------------------------------
# Never credit 1581 above the source pond's book balance. Cap is always correct.
# When unrelieved share of line cost exceeds this, emit an ops *warning* (still accepted).
BIO_CAP_SHARE_WARN_THRESHOLD = Decimal("0.05")  # 5%

BIO_CAP_POLICY = (
    "Accepted: Cr 1581 on IPT is capped at the selling pond's bio-asset book balance "
    "after expense→1581 reclass. Sale price to the buyer is never capped. "
    "Do not post phantom 1581 to match management cost. Investigate large caps as "
    "capitalization completeness (inventoriable costs still in expense)."
)

# --- Book vs sample biomass ------------------------------------------------
# Dual truth: heads/custody = book ledger; ops biomass = sample×heads; GL = cost.
# Weight-only AUTO reval may bridge book kg (no GL). Never mark 1581 to sample FV.
BIOMASS_BAND_NORMAL = Decimal("0.15")  # |eff−book|/book ≤ 15%
BIOMASS_BAND_REVIEW = Decimal("0.25")  # 15–25% ops review; >25% investigate

BIOMASS_DUAL_TRUTH_POLICY = (
    "Book kg and sample×heads (effective) are allowed to diverge. "
    "≤15% of book: normal sample noise. 15–25%: ops review (seine, species, stale sample). "
    ">25% or eff/book > 1.20: investigate heads undercount / unrecorded mortality. "
    "True-up heads and residual bio cost only at harvest / cycle close — not mid-cycle GL FV."
)

BiomassBand = Literal["normal", "review", "investigate", "skip"]


def _money(d: Decimal | int | float | str | None) -> Decimal:
    if d is None:
        return Decimal("0")
    return Decimal(str(d)).quantize(MONEY_Q, rounding=ROUND_HALF_UP)


def bio_cap_unrelieved_share(
    line_cost: Decimal | int | float | str | None,
    gl_amount: Decimal | int | float | str | None,
) -> Decimal | None:
    """
    Fraction of management line cost not relieved on Cr 1581.
    None when there is no positive line cost or GL is not a under-relief cap.
    """
    cost = _money(line_cost)
    gl = _money(gl_amount)
    if cost <= 0:
        return None
    if gl <= 0 or gl >= cost:
        return None
    return ((cost - gl) / cost).quantize(RATIO_Q, rounding=ROUND_HALF_UP)


def bio_cap_needs_ops_warning(
    line_cost: Decimal | int | float | str | None,
    gl_amount: Decimal | int | float | str | None,
    *,
    threshold: Decimal = BIO_CAP_SHARE_WARN_THRESHOLD,
) -> tuple[bool, Decimal | None]:
    """True when capped under-relief share exceeds the ops alert threshold."""
    share = bio_cap_unrelieved_share(line_cost, gl_amount)
    if share is None:
        return False, None
    return share > threshold, share


def biomass_divergence_ratio(
    book_kg: Decimal | int | float | str | None,
    effective_kg: Decimal | int | float | str | None,
) -> Decimal | None:
    """|effective − book| / book when book > 0; else None."""
    book = Decimal(str(book_kg or 0))
    eff = Decimal(str(effective_kg or 0))
    if book <= 0:
        return None
    return (abs(eff - book) / book).quantize(RATIO_Q, rounding=ROUND_HALF_UP)


def classify_biomass_band(
    book_kg: Decimal | int | float | str | None,
    effective_kg: Decimal | int | float | str | None,
    *,
    normal: Decimal = BIOMASS_BAND_NORMAL,
    review: Decimal = BIOMASS_BAND_REVIEW,
) -> BiomassBand:
    """
    Map book vs effective kg into policy bands.

    Also flags investigate when effective/book > 1.20 (sample implies more mass
    than book — often undercounted heads or unrecorded mortality).
    """
    book = Decimal(str(book_kg or 0))
    eff = Decimal(str(effective_kg or 0))
    if book <= 0 and eff <= 0:
        return "skip"
    if book <= 0:
        return "investigate" if abs(eff) > 0 else "skip"
    ratio_abs = abs(eff - book) / book
    if book > 0 and eff > book * Decimal("1.20"):
        return "investigate"
    if ratio_abs <= normal:
        return "normal"
    if ratio_abs <= review:
        return "review"
    return "investigate"
