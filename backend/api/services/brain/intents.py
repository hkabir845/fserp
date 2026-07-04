"""Detect what the owner is asking so Brain loads the right ERP facts."""
from __future__ import annotations

import re


def detect_intents(message: str) -> set[str]:
    lower = (message or "").lower()
    intents: set[str] = set()

    def hit(*keywords: str) -> bool:
        return any(k in lower for k in keywords)

    if hit("fcr", "feed conversion", "ফিড কনভার্শন", "খাদ্য রূপান্তর"):
        intents.add("fcr")
    if hit(
        "density", "load", "stocking", "population", "per decimal", "kg/decimal",
        "ঘনত্ব", "লোড", "ঘনত্ব", "জনসংখ্যা", "ডেসিমাল", "মাছের সংখ্যা", "স্টকিং",
    ):
        intents.add("density")
    if hit(
        "harvest", "partial harvest", "thin", "reduce population", "sell fish", "sale fish",
        "হারভেস্ট", "পাতলা", "মাছ বিক্রি", "জনসংখ্যা কমান", "বিক্রি কর",
    ):
        intents.add("harvest")
    if hit("feed", "feeding", "খাবার", "খাদ্য", "ফিড"):
        intents.add("feeding")
    if hit(
        "disease", "sick", "infection", "parasite", "fungus", "prescription", "treatment", "medicine",
        "রোগ", "অসুস্থ", "পোকা", "ছত্রাক", "প্রেসক্রিপশন", "চিকিৎসা", "ঔষধ",
    ):
        intents.add("disease")
    if hit(
        "today", "todays", "today's", "আজ", "আজকের",
    ) and hit("sale", "sales", "revenue", "বিক্রি", "আয়"):
        intents.add("sales_today")
    elif hit("sale", "sales", "revenue", "invoice", "বিক্রি", "আয়", "ইনভয়েস"):
        intents.add("sales")
    if hit(
        "profit", "net income", "p&l", "pl", "লাভ", "ক্ষতি", "নেট", "লাভক্ষতি",
    ):
        intents.add("profit")
    if hit("expense", "cost", "খরচ", "ব্যয়", "খরচ"):
        intents.add("expense")
    if hit(
        "employee", "worker", "staff", "salary", "payroll", "wage",
        "কর্মচারী", "শ্রমিক", "বেতন", "পে-রোল", "মজুরি",
    ):
        intents.add("hr")
    if hit(
        "job cut", "layoff", "fire", "terminate", "retain", "recruit", "hire", "whom to cut",
        "চাকরি কাট", "বরখাস্ত", "রাখব", "নিয়োগ", "কাকে ছাড়", "কাকে রাখ",
    ):
        intents.add("job_cut")
    if hit("pond", "পোন্ড", "পুকুর"):
        intents.add("pond")
    if hit("station", "filling", "shop", "agro", "স্টেশন", "পেট্রোল", "শপ"):
        intents.add("station")

    if not intents:
        intents.add("general")
    return intents
