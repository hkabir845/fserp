"""Detect when the owner wants a full list from a sidebar ERP module."""
from __future__ import annotations

# (module_key, entity keywords)
_MODULE_ENTITY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("employees", ("employee", "staff", "worker", "কর্মচারী", "কর্মী", "শ্রমিক", "kormi", "kormchari")),
    ("customers", ("customer", "client", "buyer", "গ্রাহক", "grahok")),
    ("vendors", ("vendor", "supplier", "সরবরাহকারী")),
    ("invoices", ("invoice", "ইনভয়েস", "sales invoice", "বিক্রির ইনভয়েস")),
    ("bills", ("bill", "purchase bill", "বিল", "ক্রয় বিল")),
    ("payments", ("payment", "receipt", "পেমেন্ট", "পাওনা")),
    ("items", ("item", "product", "sku", "পণ্য", "মাল", "প্রোডাক্ট")),
    ("stations", ("station", "filling station", "pump", "স্টেশন", "পাম্প")),
    ("tanks", ("tank", "ট্যাংক", "diesel tank", "petrol tank")),
    ("nozzles", ("nozzle", "নজল")),
    ("islands", ("island", "আইল্যান্ড")),
    ("dispensers", ("dispenser", "ডিসপেনসার")),
    ("meters", ("meter", "মিটার")),
    ("tank_dips", ("tank dip", "dip", "ডিপ", "tank dips")),
    ("shift_management", ("shift", "shift session", "শিফট")),
    ("chart_of_accounts", ("chart of account", "coa", "account chart", "হিসাব খাতা", "চার্ট অফ অ্যাকাউন্ট")),
    ("journal_entries", ("journal", "journal entry", "জার্নাল")),
    ("fund_transfers", ("fund transfer", "ফান্ড ট্রান্সফার")),
    ("loans", ("loan", "ঋণ", "লোন", "financing facility")),
    ("fixed_assets", ("fixed asset", "asset register", "স্থায়ী সম্পদ")),
    ("payroll", ("payroll", "payroll run", "পে-রোল", "বেতন রান")),
    ("tax", ("tax", "vat", "ট্যাক্স")),
    ("inventory_transfers", ("inventory transfer", "stock transfer", "ইনভেন্টরি ট্রান্সফার", "স্টক ট্রান্সফার")),
    ("ponds", ("pond", "পোন্ড", "পুকুর", "pukur")),
    ("landlords", ("landlord", "জমিদার", "land lease", "লিজ")),
    ("production_cycles", ("production cycle", "stocking batch", "cycle", "ব্যাচ", "স্টকিং ব্যাচ")),
    ("fish_transfers", ("fish transfer", "pond transfer", "মাছ স্থানান্তর", "পোন্ড ট্রান্সফার")),
    ("biomass_sampling", ("biomass", "sampling", "sample", "বায়োমাস", "স্যাম্পল")),
    ("feeding_advice", ("feeding advice", "feed advice", "ফিডিং পরামর্শ")),
    ("fish_sales", ("fish sale", "pond sale", "মাছ বিক্রি", "পোন্ড বিক্রি")),
    ("pond_expenses", ("pond expense", "pond cost", "পোন্ড খরচ")),
    ("pond_stock", ("pond stock", "pond warehouse", "pond feed stock", "পোন্ড স্টক", "পোন্ড মাল")),
    ("aquaculture_medicine", ("medicine", "aquaculture medicine", "pond care", "ঔষধ", "চিকিৎসা", "med catalog")),
    ("aquaculture_financing", ("aquaculture financing", "pond loan", "fish loan", "মৎস্য ঋণ", "পোন্ড ঋণ")),
    ("reporting_categories", ("reporting category", "রিপোর্টিং ক্যাটাগরি")),
]

_LIST_SIGNALS = (
    "list",
    "list all",
    "list my",
    "show all",
    "show me",
    "show ",
    "all ",
    "every ",
    "তালিকা",
    "সব ",
    "সকল ",
    "দাও",
    "দেখাও",
    "বলো",
    "name",
    "names",
    "নাম",
    "কতগুলো",
    "কত জন",
    "কতটি",
)


def _has_list_signal(message: str) -> bool:
    lower = (message or "").lower()
    return any(sig in lower for sig in _LIST_SIGNALS)


def is_employee_list_request(message: str) -> bool:
    return detect_list_module(message) == "employees"


def detect_list_module(message: str) -> str | None:
    """
    Return sidebar module key when the owner wants a full roster/list
    (e.g. 'list all customers', 'সব পোন্ডের তালিকা').
    """
    lower = (message or "").lower().strip()
    if not lower:
        return None

    explicit_employee = (
        "list my all employees",
        "employee list",
        "staff list",
        "names and salary",
        "name and salary",
        "কর্মচারীর তালিকা",
        "সব কর্মচারী",
        "নাম ও বেতন",
        "employee gulo",
    )
    if any(p in lower for p in explicit_employee):
        return "employees"

    list_signal = _has_list_signal(lower)
    if not list_signal:
        return None

    matches: list[str] = []
    kw_by_module = dict(_MODULE_ENTITY_KEYWORDS)
    for module_key, entity_keywords in _MODULE_ENTITY_KEYWORDS:
        if any(kw in lower for kw in entity_keywords):
            matches.append(module_key)

    if not matches:
        return None
    best = matches[0]
    best_len = 0
    for module_key in matches:
        for kw in kw_by_module[module_key]:
            if kw in lower and len(kw) > best_len:
                best_len = len(kw)
                best = module_key
    return best
