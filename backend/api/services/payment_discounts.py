"""Optional additional discounts agreed when settling a feed/medicine supplier."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

FIELDS = ("feed_discount_type", "feed_discount_value", "discount_mrp_base",
          "feed_discount_amount", "transport_discount_amount")


def parse_payment_discounts(body, vendor, existing=None):
    def money(key):
        raw = body.get(key, getattr(existing, key, 0))
        try:
            value = Decimal(str(raw or 0))
            if not value.is_finite() or value < 0 or value > Decimal("999999999999.99"):
                raise ValueError()
            return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except (InvalidOperation, ValueError):
            raise ValueError(f"{key} must be a finite, non-negative amount.")

    kind = body.get("feed_discount_type", getattr(existing, "feed_discount_type", "amount")) or "amount"
    if kind not in ("amount", "percent"):
        raise ValueError("Feed discount must be an amount or percent.")
    value, base, transport = (money(k) for k in (
        "feed_discount_value", "discount_mrp_base", "transport_discount_amount"))
    if (value or transport) and vendor.supplier_category not in vendor.PURCHASE_TERMS_CATEGORIES:
        raise ValueError("Payment discounts apply only to Feed and Medicine vendors.")
    if kind == "percent" and value:
        if value > 100 or base <= 0:
            raise ValueError("Feed discount percentage must be at most 100 and requires a positive MRP base.")
        feed = (base * value / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        feed = value
    return dict(zip(FIELDS, (kind, value, base, feed, transport)))
