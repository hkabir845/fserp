"""Detect what the owner is asking so Brain loads the right ERP facts."""
from __future__ import annotations

import re


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
    """Greeting or casual chat — skip heavy ERP snapshot."""
    return intents == {"greeting"} or intents == {"chat"}


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
    ):
        intents.add("hr")
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

    if intents:
        return intents

    if is_business_overview_question(message):
        return {"general"}

    return {"chat"}
