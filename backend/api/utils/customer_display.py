"""Resolve a single display label for Customer records (UI + GL memos)."""


def customer_display_name(customer) -> str:
    """
    Prefer display_name, then company_name (common for buses / firms),
    then first_name, then customer_number.
    """
    if customer is None:
        return ""
    dn = (getattr(customer, "display_name", None) or "").strip()
    if dn:
        return dn
    cn = (getattr(customer, "company_name", None) or "").strip()
    if cn:
        return cn
    fn = (getattr(customer, "first_name", None) or "").strip()
    if fn:
        return fn
    num = (getattr(customer, "customer_number", None) or "").strip()
    if num:
        return num
    pk = getattr(customer, "pk", None)
    return f"Customer #{pk}" if pk else ""
