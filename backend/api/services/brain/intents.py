"""Detect what the owner is asking so Brain loads the right ERP facts."""
from __future__ import annotations

import re

from api.services.brain.list_requests import detect_list_module, is_employee_list_request


def is_greeting_message(message: str) -> bool:
    """Short hellos / salutations — skip heavy ERP + LLM."""
    raw = (message or "").strip()
    if not raw or len(raw) > 48:
        return False
    lower = raw.lower()
    if re.fullmatch(r"(hello|hi|hey|hola|yo|salam|namaste|assalam)([!?.…]*)", lower):
        return True
    if lower in (
        "hello",
        "hi",
        "hey",
        "হ্যালো",
        "হাই",
        "নমস্কার",
        "সালাম",
        "আসসালামু আলাইকুম",
        "salam",
        "assalamu alaikum",
    ):
        return True
    if re.fullmatch(r"(good\s+(morning|afternoon|evening))[!?.…]*", lower):
        return True
    if re.fullmatch(r"(kemon\s+acho|ki\s+khobor|ki\s+obostha)[!?.…]*", lower):
        return True
    return False


def is_employee_list_request(message: str) -> bool:
    return detect_list_module(message) == "employees"


def wants_advisory_extras(message: str, intents: set[str] | None = None) -> bool:
    """Owner explicitly wants compare, advice, warnings, forecast, roadmap, or decision support."""
    if wants_benchmark_or_decision_research(message):
        return True
    if is_business_overview_question(message):
        return True
    intents = intents or set()
    if intents & {"benchmark", "decision", "predict", "job_cut", "disease"}:
        return True
    lower = (message or "").lower()
    extra = (
        "roadmap",
        "action plan",
        "next step",
        "improve",
        "improvement",
        "warning",
        "warn",
        "outlook",
        "road map",
        "plan koro",
        "plan dao",
        "রোডম্যাপ",
        "পরিকল্পনা",
        "উন্নতি",
        "সতর্ক",
        "সতর্কতা",
        "পরবর্তী",
        "ধাপ",
        "কী করব",
        "ki korbo",
        "kivabe",
        "overview",
        "audit",
        "gap analysis",
        "worldfish",
    )
    return any(k in lower for k in extra)


def wants_execution_actions(message: str, intents: set[str] | None = None) -> bool:
    """Owner asked to execute, approve, or implement — not just inform."""
    lower = (message or "").lower()
    intents = intents or set()
    if intents & {"disease", "job_cut", "harvest"}:
        return True
    exec_kw = (
        "execute",
        "do it",
        "apply",
        "approve",
        "implement",
        "go ahead",
        "start harvest",
        "cut job",
        "fire ",
        "koro",
        "korun",
        "kore dao",
        "শুরু কর",
        "এপ্রুভ",
        "বাস্তবায়ন",
        "করে দাও",
        "করে দিন",
    )
    return any(k in lower for k in exec_kw)


def wants_benchmark_or_decision_research(message: str) -> bool:
    """Questions that benefit from world standards, forecasts, or decision support."""
    lower = (message or "").lower()
    keywords = (
        "worldfish",
        "world fish",
        "gap",
        "shortage",
        "audit",
        "ঘাটতি",
        "ওয়ার্ল্ডফিশ",
        "compare",
        "comparison",
        "benchmark",
        "standard",
        "world",
        "global",
        "industry",
        "international",
        "best practice",
        "predict",
        "prediction",
        "forecast",
        "future",
        "consequence",
        "what if",
        "what will",
        "decide",
        "decision",
        "should i",
        "recommend",
        "recommendation",
        "suggest",
        "advice",
        "advisory",
        "risk",
        "opportunity",
        "তুলনা",
        "মান",
        "আন্তর্জাতিক",
        "বিশ্ব",
        "পূর্বাভাস",
        "ভবিষ্যৎ",
        "ফলাফল",
        "সিদ্ধান্ত",
        "পরামর্শ",
        "উচিত",
        "ঝুঁকি",
        "সুযোগ",
        "বেঞ্চমার্ক",
        "স্ট্যান্ডার্ড",
        "ভালো কিনা",
        "kemon hobe",
        "ki hobe",
        "ki korbo",
        "kivabe",
    )
    return any(k in lower for k in keywords)


def is_business_overview_question(message: str) -> bool:
    """Broad 'how is the business' questions — load ERP summary."""
    lower = (message or "").lower()
    keywords = (
        "overview",
        "summary",
        "saransho",
        "sarangsho",
        "সারাংশ",
        "সংক্ষিপ্ত",
        "কোম্পানি",
        "company",
        "business",
        "ব্যবসা",
        "ব্যবসার",
        "অবস্থা",
        "obostha",
        "চলছে",
        "cholche",
        "cholche kemon",
        "kemon cholche",
        "performance",
        "পারফরম্যান্স",
        "overall",
        "মোট হিসাব",
        "হিসাব",
        "report ta",
        "update dao",
        "আপডেট",
    )
    return any(k in lower for k in keywords)


def is_light_context(intents: set[str]) -> bool:
    """Greeting, casual chat, or high-level company talk — skip heavy ERP snapshot."""
    if intents == {"greeting"} or intents == {"chat"}:
        return True
    if intents == {"general"}:
        return True
    return is_conversational_turn(intents)


# Intents that need precise ERP numbers, lists, or analytics — not pure ChatGPT chat.
ERP_DATA_INTENTS = frozenset(
    {
        "fcr",
        "density",
        "biomass",
        "harvest",
        "feeding",
        "disease",
        "sales",
        "sales_today",
        "profit",
        "expense",
        "hr",
        "job_cut",
        "customer_ar",
        "vendor_ap",
        "payments",
        "inventory",
        "fuel",
        "accounting",
        "loans",
        "fixed_assets",
        "aquaculture_ops",
        "benchmark",
        "decision",
        "predict",
        "module_list",
    }
)


def is_conversational_turn(intents: set[str]) -> bool:
    """
    ChatGPT-style turn: general knowledge, casual chat, or company talk without
    needing a full ERP data pull. Uses LLM + light company context.
    """
    if not intents or intents == {"greeting"}:
        return False
    if intents <= {"chat", "general", "pond", "station"}:
        return True
    return not bool(intents & ERP_DATA_INTENTS)


def detect_intents(message: str) -> set[str]:
    if is_greeting_message(message):
        return {"greeting"}

    lower = (message or "").lower()
    intents: set[str] = set()

    def hit(*keywords: str) -> bool:
        return any(k in lower for k in keywords)

    if hit("fcr", "feed conversion", "ফিড কনভার্শন", "খাদ্য রূপান্তর"):
        intents.add("fcr")
    if hit(
        "density",
        "load",
        "what is density",
        "density means",
        "density mane",
        "ঘনত্ব কী",
        "ঘনত্ব মane",
        "stocking",
        "population",
        "per decimal",
        "kg/decimal",
        "ঘনত্ব",
        "লোড",
        "জনসংখ্যা",
        "ডেসিমাল",
        "মাছের সংখ্যা",
        "স্টকিং",
        "ghontv",
        "stocking kora",
    ):
        intents.add("density")
    if hit(
        "biomass",
        "bio mass",
        "total biomass",
        "market value",
        "approximate value",
        "average sale",
        "avg sale",
        "sale price",
        "বায়োমাস",
        "মোট বায়োমাস",
        "বাজার মূল্য",
        "আনুমানিক মূল্য",
        "গড় বিক্রয়",
        "বিক্রয় দর",
    ):
        intents.add("biomass")
    if hit(
        "harvest",
        "partial harvest",
        "thin",
        "reduce population",
        "sell fish",
        "sale fish",
        "হারভেস্ট",
        "পাতলা",
        "মাছ বিক্রি",
        "জনসংখ্যা কমান",
        "বিক্রি কর",
        "harvest kora",
    ):
        intents.add("harvest")
    if hit("feed", "feeding", "খাবার", "খাদ্য", "ফিড", "feeding plan"):
        intents.add("feeding")
    if hit(
        "disease",
        "sick",
        "infection",
        "parasite",
        "fungus",
        "prescription",
        "treatment",
        "medicine",
        "রোগ",
        "অসুস্থ",
        "পোকা",
        "ছত্রাক",
        "প্রেসক্রিপশন",
        "চিকিৎসা",
        "ঔষধ",
        "rog",
        "oshustho",
    ):
        intents.add("disease")
    if hit(
        "today",
        "todays",
        "today's",
        "আজ",
        "আজকের",
        "ajker",
        "aajker",
        "ajke",
        "aajke",
    ) and hit("sale", "sales", "revenue", "বিক্রি", "আয়", "bikri", "bikroy"):
        intents.add("sales_today")
    elif hit(
        "sale",
        "sales",
        "revenue",
        "invoice",
        "বিক্রি",
        "আয়",
        "ইনভয়েস",
        "bikri",
        "bikroy",
        "bechakini",
        "sell",
    ):
        intents.add("sales")
    if hit(
        "profit",
        "net income",
        "p&l",
        "pl",
        "লাভ",
        "ক্ষতি",
        "নেট",
        "লাভক্ষতি",
        "labh",
        "munafa",
        "loss",
        "income",
    ):
        intents.add("profit")
    if hit(
        "expense",
        "cost",
        "খরচ",
        "ব্যয়",
        "kharcha",
        "kharch",
        "khros",
        "bill",
    ):
        intents.add("expense")
    if hit(
        "employee",
        "worker",
        "staff",
        "salary",
        "payroll",
        "wage",
        "কর্মচারী",
        "শ্রমিক",
        "বেতন",
        "পে-রোল",
        "মজুরি",
        "kormi",
        "kormchari",
        "bheton",
        "staff er",
        "list",
        "তালিকা",
        "names",
        "নাম",
    ):
        intents.add("hr")
    if detect_list_module(message):
        intents.add("module_list")
    if hit(
        "job cut",
        "layoff",
        "fire",
        "terminate",
        "retain",
        "recruit",
        "hire",
        "whom to cut",
        "চাকরি কাট",
        "বরখাস্ত",
        "রাখব",
        "নিয়োগ",
        "কাকে ছাড়",
        "কাকে রাখ",
        "chakri kat",
    ):
        intents.add("job_cut")
    if hit("pond", "পোন্ড", "পুকুর", "pukur", "ponde"):
        intents.add("pond")
    if hit("station", "filling", "shop", "agro", "স্টেশন", "পেট্রোল", "শপ", "pump"):
        intents.add("station")
    if hit(
        "customer",
        "client",
        "buyer",
        "গ্রাহক",
        "grahok",
        "receivable",
        "a/r",
        "ar balance",
        "due invoice",
        "overdue",
        "বকেয়া",
        "বাকি",
        "due ache",
    ):
        intents.add("customer_ar")
    if hit(
        "vendor",
        "supplier",
        "সরবরাহকারী",
        "payable",
        "a/p",
        "ap balance",
        "open bill",
        "বিল বাকি",
    ):
        intents.add("vendor_ap")
    if hit(
        "payment",
        "receipt",
        "received",
        "paid",
        "deposit",
        "পেমেন্ট",
        "টাকা পেলাম",
        "টাকা দিলাম",
        "collection",
        "পাওনা আদায়",
    ):
        intents.add("payments")
    if hit(
        "inventory",
        "stock",
        "item",
        "reorder",
        "low stock",
        "স্টক",
        "ইনভেন্টরি",
        "মাল",
        "stock koto",
        "stock ache",
    ):
        intents.add("inventory")
    if hit(
        "tank",
        "nozzle",
        "shift",
        "dip",
        "forecourt",
        "fuel stock",
        "ট্যাংক",
        "নজল",
        "শিফট",
        "ডিপ",
        "diesel stock",
        "petrol stock",
    ):
        intents.add("fuel")
    if hit(
        "journal",
        "ledger",
        "gl",
        "accounting",
        "fund transfer",
        "জার্নাল",
        "হিসাব",
        "লেজার",
    ):
        intents.add("accounting")
    if hit("loan", "borrow", "lend", "financing", "ঋণ", "লোন", "loan er"):
        intents.add("loans")
    if hit(
        "landlord",
        "land lease",
        "warehouse transfer",
        "stock transfer",
        "production cycle",
        "জমিদার",
        "লিজ",
    ):
        intents.add("aquaculture_ops")
    if hit("asset", "depreciation", "fixed asset", "স্থায়ী সম্পদ", "ডিপ্রিসিয়েশন"):
        intents.add("fixed_assets")
    if wants_benchmark_or_decision_research(message):
        intents.add("benchmark")
        intents.add("decision")
    if hit(
        "predict",
        "forecast",
        "future",
        "পূর্বাভাস",
        "ভবিষ্যৎ",
        "আগামী",
        "next month",
        "পরের মাস",
    ):
        intents.add("predict")

    if intents:
        return intents

    if is_business_overview_question(message):
        return {"general"}

    return {"chat"}
