"""
Bilingual (en / bn) strings for aquaculture load, harvest, and feeding advice.

Convention: Bangla prose uses Bengali script; digits stay Western (0-9), not Bengali numerals.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from api.services.app_i18n import (
    AppLang,
    ALLOWED_APP_LANGUAGES,
    company_language,
    normalize_lang,
    pick as _pick,
)

AdviceLang = AppLang

ALLOWED_ADVICE_LANGUAGES = ALLOWED_APP_LANGUAGES

# Re-export for existing imports
__all__ = [
    "AdviceLang",
    "ALLOWED_ADVICE_LANGUAGES",
    "normalize_lang",
    "company_language",
    "_pick",
    "load_level_label",
    "load_set_water_area_summary",
    "load_reference_note",
    "load_unknown_reference_note",
    "load_advice_summary",
    "load_volume_density_extra",
    "partial_harvest_no_thin_rationale",
    "partial_harvest_rationale",
    "owner_decision_set_pond_area_fallback",
    "owner_decision_partial_harvest",
    "owner_decision_grow",
    "owner_decision_monitor",
    "fish_per_kg_source",
    "fish_per_kg_source_key_from_label",
    "temp_factor_note",
    "weather_tier_label",
]


def load_level_label(level: str, lang: str | None = "en") -> str:
    lv = (level or "").strip()
    labels = {
        "understocked": ("Light load", "হালকা লোড"),
        "moderate": ("Moderate", "মাঝারি"),
        "full": ("Full", "পূর্ণ"),
        "high_risk": ("High load", "উচ্চ লোড"),
        "unknown": ("Unknown", "অজানা"),
    }
    en, bn = labels.get(lv, ("Unknown", "অজানা"))
    return _pick(lang, en, bn)


def load_set_water_area_summary(lang: str | None = "en") -> str:
    return _pick(
        lang,
        "Set water area (decimal) on the pond to estimate kg per decimal and load.",
        "পুকুরে জলের আয়তন (ডেসিমেল) দিন — kg/ডেসিমেল ও লোড হিসাব করা যাবে।",
    )


def load_reference_note(lang: str | None = "en") -> str:
    return _pick(
        lang,
        "Rule-of-thumb bands (not regulatory): grow-out targets ~8–12 t/ha harvest biomass "
        "(≈35–50 kg/decimal); adjust with aeration, species, and water quality.",
        "নির্দেশক ব্যান্ড (আইনি নয়): গ্রো-আউট লক্ষ্য ~8–12 টন/হেক্টর (≈35–50 kg/ডেসিমেল); "
        "এয়ারেশন, প্রজাতি ও পানির গুণমান অনুযায়ী ঠিক করুন।",
    )


def load_unknown_reference_note(lang: str | None = "en") -> str:
    return _pick(
        lang,
        "Indicative bands for intensive aerated pond culture; species, aeration, and water quality change safe limits.",
        "নির্দেশক ব্যান্ড (নিবিড় এয়ারেটেড পুকুর); প্রজাতি, এয়ারেশন ও পানির গুণমান নিরাপদ সীমা বদলায়।",
    )


def load_advice_summary(level: str, kpd: Decimal, lang: str | None = "en") -> str:
    lv = (level or "").strip()
    k = str(kpd)
    if lv == "understocked":
        return _pick(
            lang,
            f"About {k} kg per decimal of water surface — below typical intensive stocking for this role; "
            "room to grow biomass if production targets allow.",
            f"প্রায় {k} kg/ডেসিমেল জলের উপরিভাগ — এই ভূমিকার জন্য সাধারণ নিবিড় স্টকিংয়ের নিচে; "
            "উৎপাদন লক্ষ্য থাকলে বায়োমাস বাড়ানো যায়।",
        )
    if lv == "moderate":
        return _pick(
            lang,
            f"About {k} kg per decimal — within a common comfort range for this pond role; monitor DO and growth.",
            f"প্রায় {k} kg/ডেসিমেল — এই পুকুরের জন্য স্বাচ্ছন্দ্যময় সীমার মধ্যে; DO ও বৃদ্ধি পর্যবেক্ষণ করুন।",
        )
    if lv == "full":
        return _pick(
            lang,
            f"About {k} kg per decimal — approaching high biomass; watch dissolved oxygen, feeding, and losses closely.",
            f"প্রায় {k} kg/ডেসিমেল — বায়োমাস বেশি; দ্রবীত অক্সিজেন, খাবার ও ক্ষতি ঘনিষ্ঠভাবে দেখুন।",
        )
    if lv == "high_risk":
        return _pick(
            lang,
            f"About {k} kg per decimal — stress risk is elevated; consider harvest timing, aeration, or thinning transfers.",
            f"প্রায় {k} kg/ডেসিমেল — চাপের ঝুঁকি বেশি; ধরার সময়, এয়ারেশন বা পাতলা স্থানান্তর বিবেচনা করুন।",
        )
    return ""


def load_volume_density_extra(kg_per_kcuft: Decimal, lang: str | None = "en") -> str:
    k = str(kg_per_kcuft)
    return _pick(
        lang,
        f" Volume density ≈ {k} kg per 1,000 cu ft.",
        f" আয়তন ঘনত্ব ≈ {k} kg প্রতি 1,000 ঘন ফুট।",
    )


def partial_harvest_no_thin_rationale(
    kg_per_dec: Decimal, level: str, comfort: Decimal, lang: str | None = "en"
) -> str:
    k = str(kg_per_dec)
    c = str(comfort)
    lvl = level or "within range"
    return _pick(
        lang,
        f"Load is {k} kg/decimal ({lvl}). No thinning suggested; comfort target is about {c} kg/decimal.",
        f"লোড {k} kg/ডেসিমেল ({lvl})। পাতলা করার পরামর্শ নেই; স্বাচ্ছন্দ্য লক্ষ্য প্রায় {c} kg/ডেসিমেল।",
    )


def partial_harvest_rationale(
    *,
    level: str,
    kg_per_dec: Decimal,
    comfort: Decimal,
    remove_kg: Decimal,
    remove_heads: int | None,
    post_kpd: Decimal,
    lang: str | None = "en",
) -> str:
    k = str(kg_per_dec)
    c = str(comfort)
    r = str(remove_kg)
    p = str(post_kpd)
    level_lbl_en = "high load" if level == "high_risk" else "full load"
    level_lbl_bn = "উচ্চ লোড" if level == "high_risk" else "পূর্ণ লোড"
    heads_en = f" (~{remove_heads:,} fish)" if remove_heads else ""
    heads_bn = f" (~{remove_heads:,} মাছ)" if remove_heads else ""
    return _pick(
        lang,
        f"Pond is at {level_lbl_en} ({k} kg/decimal). "
        f"To reach the comfort band (~{c} kg/decimal), consider removing about "
        f"{r} kg{heads_en}. Post-harvest load would be ~{p} kg/decimal. "
        "You may adjust the harvest amount based on field conditions.",
        f"পুকুর {level_lbl_bn} ({k} kg/ডেসিমেল)। স্বাচ্ছন্দ্য ব্যান্ডে (~{c} kg/ডেসিমেল) "
        f"আসতে প্রায় {r} kg{heads_bn} তুলে নেওয়ার কথা বিবেচনা করুন। "
        f"ধরার পর লোড ~{p} kg/ডেসিমেল হবে। মাঠের অবস্থা অনুযায়ী পরিমাণ ঠিক করুন।",
    )


def owner_decision_set_pond_area_fallback(lang: str | None = "en") -> str:
    return _pick(
        lang,
        "Set water area (decimal) on the pond to estimate load per decimal.",
        "পুকুরে জলের আয়তন (ডেসিমেল) দিন — kg/ডেসিমেল লোড হিসাব করা যাবে।",
    )


def owner_decision_partial_harvest(
    *,
    load_label: str,
    level: str,
    kpd: str | None,
    sk: str,
    sh: int | None,
    comfort: Decimal,
    lang: str | None = "en",
) -> str:
    lbl = load_label or level
    heads_en = f" (~{int(sh):,} fish)" if sh else ""
    heads_bn = f" (~{int(sh):,} মাছ)" if sh else ""
    c = str(comfort)
    return _pick(
        lang,
        f"Load is {lbl} at {kpd} kg/decimal. "
        f"Consider partial harvest: remove about {sk} kg{heads_en} to reach the comfort band "
        f"(~{c} kg/decimal of water surface).",
        f"লোড {lbl}, {kpd} kg/ডেসিমেল। আংশিক ধরা বিবেচনা করুন: স্বাচ্ছন্দ্য ব্যান্ডে "
        f"(~{c} kg/ডেসিমেল) আসতে প্রায় {sk} kg{heads_bn} তুলুন।",
    )


def owner_decision_grow(kpd: str | None, comfort: Decimal, lang: str | None = "en") -> str:
    c = str(comfort)
    return _pick(
        lang,
        f"Load is light ({kpd} kg/decimal). No thinning needed — biomass can grow toward the comfort band (~{c} kg/decimal).",
        f"লোড হালকা ({kpd} kg/ডেসিমেল)। পাতলা করার দরকার নেই — বায়োমাস স্বাচ্ছন্দ্য ব্যান্ডে (~{c} kg/ডেসিমেল) বাড়তে পারে।",
    )


def owner_decision_monitor(kpd: str | None, lang: str | None = "en") -> str:
    return _pick(
        lang,
        f"Load is moderate ({kpd} kg/decimal). No partial harvest required; monitor growth, feeding, and dissolved oxygen.",
        f"লোড মাঝারি ({kpd} kg/ডেসিমেল)। আংশিক ধরার দরকার নেই; বৃদ্ধি, খাবার ও দ্রবীত অক্সিজেন পর্যবেক্ষণ করুন।",
    )


def fish_per_kg_source(source_key: str, lang: str | None = "en") -> str:
    keys = {
        "latest_biomass_sample": ("latest biomass sample", "সর্বশেষ বায়োমাস নমুনা"),
        "latest_sample_avg_weight": ("latest sample avg weight", "নমুনার গড় ওজন"),
        "implied_net_stock": ("implied net stock", "বইয়ের নিট স্টক"),
    }
    en, bn = keys.get(source_key, (source_key, source_key))
    return _pick(lang, en, bn)


def fish_per_kg_source_key_from_label(label: str) -> str:
    if label == "latest biomass sample":
        return "latest_biomass_sample"
    if label == "latest sample avg weight":
        return "latest_sample_avg_weight"
    if label == "implied net stock":
        return "implied_net_stock"
    return label


def temp_factor_note(water_temp_c: Decimal | None, lang: str | None = "en") -> tuple[Decimal, str]:
    """Simple extension-style appetite scalar vs ~28 °C optimum."""
    from decimal import Decimal as D

    if water_temp_c is None:
        return D("1"), _pick(
            lang,
            "temperature not provided — assuming favourable grow-out conditions (~26–30 °C)",
            "পানির তাপমাত্রা দেওয়া নেই — অনুকূল গ্রো-আউট (~26–30 °C) ধরে নেওয়া হয়েছে",
        )
    t = water_temp_c
    if t < D("18"):
        return D("0.45"), _pick(
            lang,
            f"cool water ({t} °C) — strong ration cut; verify fish are feeding",
            f"ঠান্ডা পানি ({t} °C) — খাবার কমান; মাছ খাচ্ছে কিনা দেখুন",
        )
    if t < D("22"):
        return D("0.65"), _pick(
            lang,
            f"sub-optimal temperature ({t} °C) — reduce ration",
            f"অনুকূল নয় ({t} °C) — দৈনিক খাবার কমান",
        )
    if t < D("26"):
        return D("0.85"), _pick(
            lang,
            f"moderate temperature ({t} °C) — slight reduction vs peak appetite",
            f"মাঝারি তাপ ({t} °C) — চরম ক্ষুধার তুলনায় সামান্য কম",
        )
    if t <= D("30"):
        return D("1.0"), _pick(
            lang,
            f"near-optimal band ({t} °C) — tables align with ~28 °C references",
            f"প্রায় অনুকূল ({t} °C) — ~28 °C রেফারেন্স টেবিলের সাথে মিল",
        )
    if t <= D("32"):
        return D("0.9"), _pick(
            lang,
            f"warm ({t} °C) — watch DO; avoid over-feeding",
            f"গরম ({t} °C) — DO দেখুন; বেশি খাবার দেবেন না",
        )
    return D("0.75"), _pick(
        lang,
        f"hot ({t} °C) — heat stress risk; feed conservatively",
        f"খুব গরম ({t} °C) — তাপ চাপ; সাবধানে খাবার দিন",
    )


def weather_tier_label(water_temp_c: Decimal | None, lang: str | None = "en") -> tuple[str, str]:
    """Returns (tier_key, short_label)."""
    from decimal import Decimal as D

    if water_temp_c is None:
        return (
            "unknown",
            _pick(
                lang,
                "Weather (water): not recorded — enter °C when generating advice",
                "আবহাওয়া (পানি): রেকর্ড নেই — পরামর্শের সময় °C দিন",
            ),
        )
    wt = water_temp_c
    if wt < D("18"):
        return (
            "very_cold",
            _pick(lang, f"Weather (water): very cold (~{wt} °C) — strong appetite reduction", f"পানি খুব ঠান্ডা (~{wt} °C) — ক্ষুধা কম"),
        )
    if wt < D("20"):
        return ("cold", _pick(lang, f"Weather (water): cold (~{wt} °C) — low appetite", f"পানি ঠান্ডা (~{wt} °C) — ক্ষুধা কম"))
    if wt < D("24"):
        return ("cool", _pick(lang, f"Weather (water): cool (~{wt} °C) — moderate appetite", f"পানি ঠাণ্ডা (~{wt} °C) — মাঝারি ক্ষুধা"))
    if wt <= D("28"):
        return ("optimal", _pick(lang, f"Weather (water): favourable (~{wt} °C) — good feeding window", f"পানি অনুকূল (~{wt} °C) — ভালো খাওয়ানোর সময়"))
    if wt <= D("31"):
        return ("warm", _pick(lang, f"Weather (water): warm (~{wt} °C) — watch DO; avoid harsh mid-day", f"পানি গরম (~{wt} °C) — DO দেখুন; দুপুরে এড়ান"))
    return ("very_hot", _pick(lang, f"Weather (water): hot (~{wt} °C) — feed only in coolest hours", f"পানি খুব গরম (~{wt} °C) — শীতল সময়ে খাবার দিন"))


_STOCK_LEDGER_ENTRY_KIND_BN: dict[str, str] = {
    "loss": "ক্ষতি (মৃত্যু, শিকারী, চুরি ইত্যাদি)",
    "adjustment": "ম্যানুয়াল সংখ্যা / ওজন সমন্বয়",
}

_STOCK_LEDGER_LOSS_REASON_BN: dict[str, str] = {
    "mortality": "মৃত্যু (প্রাকৃতিক / অশ্রেণীবদ্ধ)",
    "disease": "মৃত্যু — রোগ / চিকিৎসা ক্ষতি",
    "predator_snake": "শিকারী — সাপ",
    "predator_other": "শিকারী — মাছ, স্তন্যপায়ী বা অন্যান্য",
    "birds": "পাখি",
    "theft_escape": "চুরি বা পালানো",
    "other_loss": "অন্যান্য ক্ষতি",
}


def stock_ledger_entry_kind_label(code: str, lang: str | None = "en") -> str:
    from api.services.aquaculture_constants import STOCK_LEDGER_ENTRY_KIND_LABELS

    en = STOCK_LEDGER_ENTRY_KIND_LABELS.get(code, code)
    bn = _STOCK_LEDGER_ENTRY_KIND_BN.get(code, en)
    return _pick(lang, en, bn)


def stock_ledger_loss_reason_label(code: str, lang: str | None = "en") -> str:
    from api.services.aquaculture_constants import STOCK_LEDGER_LOSS_REASON_LABELS

    en = STOCK_LEDGER_LOSS_REASON_LABELS.get(code, code)
    bn = _STOCK_LEDGER_LOSS_REASON_BN.get(code, en)
    return _pick(lang, en, bn)


def stock_ledger_coa_note(lang: str | None = "en") -> str:
    from api.services.aquaculture_constants import STOCK_LEDGER_COA_NOTE

    bn = (
        "ঐচ্ছিক GL পোস্টিং: 1581 জৈবিক ইনভেন্টরি (সম্পদ), 6726 মৃত্যু ও ক্ষয় (খরচ), "
        "4244 জৈবিক সংখ্যা লাভ (আয়)। কোড না থাকলে Company settings সংরক্ষণ বা COA seed চালান।"
    )
    return _pick(lang, STOCK_LEDGER_COA_NOTE, bn)

