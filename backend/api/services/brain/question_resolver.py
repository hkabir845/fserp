"""Resolve partial module/feature mentions and answer scope for Company Brain."""
from __future__ import annotations

from api.services.brain.list_requests import _MODULE_ENTITY_KEYWORDS
from api.services.brain.module_registry import SIDEBAR_MODULE_KEYS

# Partial Banglish, abbreviations, and feature fragments → sidebar module keys
_MODULE_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    *_MODULE_ENTITY_KEYWORDS,
    ("invoices", ("bikri", "bikroy", "bechakini", "sales", "revenue", "sell", "আয়")),
    ("bills", ("kroy", "purchase", "ক্রয়", "vendor bill")),
    ("customers", ("due", "receivable", "a/r", "ar ", "overdue", "বকেয়া", "বাকি")),
    ("vendors", ("payable", "a/p", "ap ", "supplier due")),
    ("employees", ("bheton", "salary", "wage", "payroll staff", "মজুরি")),
    ("payroll", ("salary run", "pay run", "বেতন রান")),
    ("inventory_stock", ("stock level", "reorder", "low stock", "মাল কম")),
    ("items", ("sku", "product list", "service item")),
    ("fuel_forecourt", ("forecourt", "pump stock", "fuel level")),
    ("tanks", ("diesel", "petrol", "octane", "fuel tank")),
    ("ponds", ("pukur", "ponde", "fish pond", "মাছের পোন্ড")),
    ("feeding_advice", ("feed plan", "feeding plan", "খাবার পরিমাণ")),
    ("aquaculture_medicine", ("med", "antibiotic", "probiotic", "pond care")),
    ("fish_sales", ("harvest sale", "pond harvest")),
    ("pond_expenses", ("pond cost", "aquaculture expense")),
    ("chart_of_accounts", ("account list", "ledger account")),
    ("journal_entries", ("jv", "journal voucher")),
    ("shift_management", ("shift report", "cashier shift")),
    ("dashboard", ("home", "summary page", "overview page")),
    ("pos_cashier", ("pos", "cashier", "counter")),
    ("reports", ("report hub", "analytics page")),
]

# Map alias keys that are not sidebar keys to erp_modules snapshot blocks
_SNAPSHOT_BLOCK_FOR_MODULE: dict[str, str] = {
    "inventory_stock": "inventory_stock",
    "fuel_forecourt": "fuel_forecourt",
    "sales_customers_ar": "sales_customers_ar",
    "purchases_vendors_ap": "purchases_vendors_ap",
    "payments_cash": "payments_cash",
    "accounting_gl": "accounting_gl",
    "hr_payroll": "hr_payroll",
    "aquaculture_ops": "aquaculture_ops",
    "stations_sites": "stations_sites",
    "station_equipment": "station_equipment",
    "loans_financing": "loans_financing",
    "fixed_assets": "fixed_assets",
    "payroll_runs": "payroll_runs",
    "management_settings": "management_settings",
    "aquaculture_extended": "aquaculture_extended",
    "operations_summary": "operations_summary",
}

_MODULE_TO_SNAPSHOT_BLOCK: dict[str, str] = {
    "customers": "sales_customers_ar",
    "invoices": "sales_customers_ar",
    "vendors": "purchases_vendors_ap",
    "bills": "purchases_vendors_ap",
    "payments": "payments_cash",
    "items": "inventory_stock",
    "inventory_transfers": "inventory_stock",
    "tanks": "fuel_forecourt",
    "nozzles": "fuel_forecourt",
    "shift_management": "fuel_forecourt",
    "tank_dips": "fuel_forecourt",
    "journal_entries": "accounting_gl",
    "fund_transfers": "accounting_gl",
    "chart_of_accounts": "accounting_gl",
    "loans": "loans_financing",
    "fixed_assets": "fixed_assets",
    "employees": "hr_payroll",
    "payroll": "payroll_runs",
    "tax": "management_settings",
    "reporting_categories": "management_settings",
    "stations": "stations_sites",
    "tanks_alt": "station_equipment",
    "ponds": "aquaculture_ops",
    "landlords": "aquaculture_extended",
    "production_cycles": "aquaculture_ops",
    "fish_transfers": "aquaculture_ops",
    "pond_expenses": "aquaculture_ops",
    "feeding_advice": "aquaculture_ops",
    "fish_sales": "aquaculture_ops",
    "biomass_sampling": "aquaculture_ops",
    "aquaculture_medicine": "aquaculture_ops",
    "aquaculture_financing": "loans_financing",
    "pond_stock": "aquaculture_ops",
}


def match_modules_in_message(message: str) -> list[str]:
    """
    Find sidebar modules referenced by partial names, typos, or Banglish fragments.
    Returns keys sorted by longest matching keyword first.
    """
    lower = (message or "").lower().strip()
    if not lower:
        return []

    hits: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for module_key, keywords in _MODULE_ALIASES:
        if module_key not in SIDEBAR_MODULE_KEYS and module_key not in _SNAPSHOT_BLOCK_FOR_MODULE:
            continue
        for kw in keywords:
            if kw in lower:
                hits.append((len(kw), module_key, kw))
                break

    hits.sort(key=lambda x: (-x[0], x[1]))
    ordered: list[str] = []
    for _, module_key, _ in hits:
        if module_key in seen:
            continue
        seen.add(module_key)
        ordered.append(module_key)
    return ordered


def snapshot_blocks_for_modules(module_keys: list[str]) -> list[str]:
    """ERP snapshot block names relevant to matched modules."""
    blocks: list[str] = []
    seen: set[str] = set()
    for key in module_keys:
        block = _MODULE_TO_SNAPSHOT_BLOCK.get(key)
        if block and block not in seen:
            seen.add(block)
            blocks.append(block)
    return blocks


_INTENT_TOPIC_LABELS: dict[str, str] = {
    "sales_today": "আজকের বিক্রি",
    "sales": "বিক্রি/ইনভয়েস",
    "profit": "লাভ/ক্ষতি",
    "expense": "খরচ",
    "fcr": "FCR",
    "density": "ঘনত্ব/লোড",
    "harvest": "হারভেস্ট",
    "feeding": "ফিডিং",
    "disease": "রোগ/চিকিৎসা",
    "hr": "কর্মচারী/বেতন",
    "job_cut": "HR পরামর্শ",
    "customer_ar": "গ্রাহক/বকেয়া",
    "vendor_ap": "সরবরাহকারী/বিল",
    "payments": "পেমেন্ট",
    "inventory": "ইনভেন্টরি/স্টক",
    "fuel": "ট্যাংক/ফুয়েল",
    "accounting": "হিসাব/জার্নাল",
    "loans": "ঋণ",
    "fixed_assets": "স্থায়ী সম্পদ",
    "aquaculture_ops": "মৎস্য অপারেশন",
    "benchmark": "বেঞ্চমার্ক তুলনা",
    "decision": "সিদ্ধান্ত",
    "predict": "পূর্বাভাস",
    "general": "ব্যবসার সারাংশ",
    "pond": "পোন্ড",
    "station": "স্টেশন",
    "module_list": "তালিকা",
}


def is_help_or_howto_question(message: str) -> bool:
    """Questions that need external guidance (process, regulation, best practice)."""
    lower = (message or "").lower()
    keywords = (
        "how to",
        "how do",
        "how can",
        "what is",
        "what are",
        "explain",
        "guide",
        "tutorial",
        "process",
        "procedure",
        "steps",
        "help me",
        "support",
        "best way",
        "ki vabe",
        "kivabe",
        "kemon kore",
        "kivabe kora",
        "ki korle",
        "kivabe korbo",
        "banglay bolo",
        "ব্যাখ্যা",
        "কিভাবে",
        "কীভাবে",
        "পদ্ধতি",
        "ধাপ",
        "গাইড",
        "সাহায্য",
        "শিখতে",
        "process ta",
    )
    return any(k in lower for k in keywords)


def wants_breakdown(message: str) -> bool:
    """User explicitly wants station/pond/category breakdown."""
    lower = (message or "").lower()
    keywords = (
        "breakdown",
        "by station",
        "by pond",
        "station wise",
        "pond wise",
        "category wise",
        "each station",
        "each pond",
        "স্টেশন অনুযায়ী",
        "পোন্ড অনুযায়ী",
        "ভাগ করে",
        "আলাদা আলাদা",
        "station er",
        "pond er",
        "wise",
    )
    return any(k in lower for k in keywords)


_MODULE_TO_INTENT: dict[str, str] = {
    "customers": "customer_ar",
    "invoices": "sales",
    "bills": "expense",
    "vendors": "vendor_ap",
    "payments": "payments",
    "items": "inventory",
    "inventory_transfers": "inventory",
    "tanks": "fuel",
    "nozzles": "fuel",
    "shift_management": "fuel",
    "tank_dips": "fuel",
    "journal_entries": "accounting",
    "fund_transfers": "accounting",
    "chart_of_accounts": "accounting",
    "loans": "loans",
    "fixed_assets": "fixed_assets",
    "employees": "hr",
    "payroll": "hr",
    "ponds": "pond",
    "stations": "station",
    "feeding_advice": "feeding",
    "aquaculture_medicine": "disease",
    "pond_stock": "inventory",
    "aquaculture_financing": "loans",
    "fish_sales": "harvest",
    "pond_expenses": "expense",
    "production_cycles": "pond",
    "biomass_sampling": "fcr",
}


def boost_intents_from_modules(message: str, intents: set[str]) -> set[str]:
    """When the user names a module partially, infer business intents for ERP loading."""
    if intents - {"chat", "greeting", "module_list"}:
        return intents
    out = set(intents)
    for mod in match_modules_in_message(message):
        intent = _MODULE_TO_INTENT.get(mod)
        if intent:
            out.add(intent)
    return out


def build_question_focus(message: str, intents: set[str]) -> dict:
    """
    Tell Brain and the LLM exactly what to answer.
    Related cross-module context is optional unless advisory/overview scope.
    """
    matched = match_modules_in_message(message)
    blocks = snapshot_blocks_for_modules(matched)

    advisory = bool({"benchmark", "decision", "predict"} & intents)
    overview = "general" in intents
    list_req = "module_list" in intents

    if advisory:
        scope = "advisory"
    elif overview:
        scope = "overview"
    elif list_req or matched or (intents - {"chat", "greeting"}):
        scope = "focused"
    else:
        scope = "conversational"

    primary_topics = [_INTENT_TOPIC_LABELS[k] for k in sorted(intents) if k in _INTENT_TOPIC_LABELS]

    instruction_parts = [
        "শুধুমাত্র ব্যবহারকারীর প্রশ্নের উত্তর দিন — সরাসরি উত্তর দিয়ে শুরু করুন।",
        "সম্পর্কিত তথ্য ঐচ্ছিক; স্পষ্টভাবে কাজে লাগলে ১–২ সংক্ষিপ্ত বাক্যে যোগ করুন, অন্যথায় বাদ দিন।",
    ]
    if scope == "focused":
        instruction_parts.append(
            "সম্পূর্ণ MTD সারাংশ, অন্য মডিউলের সংখ্যা বা ক্রস-মডিউল বিশ্লেষণ দেবেন না যতক্ষণ না চাওয়া হয়।"
        )
    if matched:
        instruction_parts.append(
            f"ব্যবহারকারী আংশিক/সংক্ষিপ্ত নাম ব্যবহার করেছেন — ERP মডিউল: {', '.join(matched)}। "
            "erp_modules ও matched snapshot blocks থেকে সঠিক ডেটা খুঁজে নিন।"
        )
    if is_help_or_howto_question(message):
        instruction_parts.append(
            "প্রশ্নে প্রক্রিয়া/ব্যাখ্যা/সাহায্য লাগলে WEB_RESEARCH_NOTE ও প্রশিক্ষণ জ্ঞান দিয়ে পেশাদার উত্তর দিন।"
        )

    return {
        "answer_scope": scope,
        "matched_modules": matched,
        "snapshot_blocks": blocks,
        "primary_topics": primary_topics,
        "include_related_context": scope in ("advisory", "overview"),
        "wants_breakdown": wants_breakdown(message),
        "needs_external_help": is_help_or_howto_question(message),
        "instruction_bn": " ".join(instruction_parts),
    }
