"""
WorldFish / FAO gap audit for Company Brain — find ERP data shortages and
operational gaps vs tilapia best practice, with fixes pointing to FSERP modules.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.utils import timezone

from api.models import (
    AquacultureBiomassSample,
    AquacultureFishSale,
    AquaculturePond,
    AquacultureProductionCycle,
)
from api.services.aquaculture_partial_harvest import effective_biomass_kg_from_position_row
from api.services.aquaculture_sale_reference_service import company_average_fish_sale_price_per_kg
from api.services.aquaculture_stock_service import compute_fish_stock_position_rows
from api.services.brain.analytics import all_ponds_summary
from api.services.brain.decision_intelligence import INDUSTRY_BENCHMARKS, _status_vs_range


def wants_worldfish_gap_audit(message: str) -> bool:
    lower = (message or "").lower()
    keys = (
        "worldfish",
        "world fish",
        "fao",
        "gap",
        "gaps",
        "shortage",
        "shortages",
        "fix all",
        "fix them",
        "audit",
        "compliance",
        "best practice",
        "standard",
        "compare with world",
        "বিশ্ব মান",
        "ওয়ার্ল্ডফিশ",
        "ঘাটতি",
        "সমস্যা খুঁজ",
        "ঠিক কর",
        "মান যাচাই",
        "গাইডলাইন",
    )
    return any(k in lower for k in keys)


def _d(val) -> Decimal:
    try:
        return Decimal(str(val or 0))
    except Exception:
        return Decimal("0")


def _fix(
    *,
    action: str,
    label_bn: str,
    erp_path: str,
    priority: int = 2,
    pond_id: int | None = None,
    requires_approval: bool = False,
) -> dict[str, Any]:
    return {
        "action": action,
        "label_bn": label_bn,
        "erp_path": erp_path,
        "priority": priority,
        "pond_id": pond_id,
        "requires_approval": requires_approval,
    }


def _gap(
    *,
    code: str,
    category: str,
    severity: str,
    message_bn: str,
    fix_bn: str,
    erp_path: str,
    pond_id: int | None = None,
    pond_name: str | None = None,
    metric: str | None = None,
    your_value: str | float | None = None,
    benchmark: str | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "category": category,
        "severity": severity,
        "pond_id": pond_id,
        "pond_name": pond_name,
        "message_bn": message_bn,
        "fix_bn": fix_bn,
        "erp_path": erp_path,
        "metric": metric,
        "your_value": your_value,
        "benchmark": benchmark,
        "source": "WorldFish/FAO tilapia culture guides",
    }


def build_worldfish_gap_audit(
    company_id: int,
    *,
    lang: str = "bn",
    sample_stale_days: int = 90,
) -> dict[str, Any]:
    """
    Scan active ponds: missing ERP records + performance vs WorldFish/FAO benchmarks.
    Returns gaps and prioritized fixes (ERP module paths) — Brain applies these as suggested_actions.
    """
    today = timezone.localdate()
    stale_cutoff = today - timedelta(days=max(30, sample_stale_days))

    ponds = list(
        AquaculturePond.objects.filter(company_id=company_id, is_active=True).order_by("sort_order", "id")
    )
    stock_by_pond = {
        int(r["pond_id"]): r
        for r in compute_fish_stock_position_rows(company_id, include_inactive_ponds=False)
    }

    latest_sample: dict[int, AquacultureBiomassSample] = {}
    for s in (
        AquacultureBiomassSample.objects.filter(company_id=company_id)
        .select_related("pond")
        .order_by("pond_id", "-sample_date", "-id")
    ):
        if s.pond_id and s.pond_id not in latest_sample:
            latest_sample[s.pond_id] = s

    active_cycles = {
        c.pond_id: c
        for c in AquacultureProductionCycle.objects.filter(
            company_id=company_id, end_date__isnull=True
        ).select_related("pond")
    }

    company_avg_sale = company_average_fish_sale_price_per_kg(company_id)
    has_any_fish_sale = AquacultureFishSale.objects.filter(company_id=company_id).exists()

    fcr_bench = INDUSTRY_BENCHMARKS["aquaculture_fcr_tilapia"]
    density_bench = INDUSTRY_BENCHMARKS["pond_density_kg_per_decimal"]

    gaps: list[dict[str, Any]] = []
    fixes: list[dict[str, Any]] = []
    seen_fix_keys: set[str] = set()

    def add_fix(item: dict[str, Any]) -> None:
        key = f"{item.get('action')}:{item.get('pond_id')}:{item.get('erp_path')}"
        if key in seen_fix_keys:
            return
        seen_fix_keys.add(key)
        fixes.append(item)

    if not ponds:
        gaps.append(
            _gap(
                code="no_active_ponds",
                category="setup",
                severity="high",
                message_bn="কোনো সক্রিয় পোন্ড নেই — WorldFish-স্টাইল ঘনত্ব/ফিডিং পরামর্শের জন্য পোন্ড তৈরি করুন।",
                fix_bn="পোন্ড যোগ করুন (নাম, জলের ক্ষেত্রফল ডেসিমালে)।",
                erp_path="/aquaculture/ponds",
            )
        )
        add_fix(
            _fix(
                action="create_pond",
                label_bn="পোন্ড তৈরি করুন — জলের ক্ষেত্রফল (ডেসিমাল) অবশ্যই দিন",
                erp_path="/aquaculture/ponds",
                priority=1,
            )
        )

    for pond in ponds:
        pname = (pond.name or "").strip() or f"Pond #{pond.id}"
        stock = stock_by_pond.get(pond.id, {})
        biomass = effective_biomass_kg_from_position_row(stock) if stock else Decimal("0")
        fish_count = int(stock.get("implied_net_fish_count") or 0)
        water_dec = pond.water_area_decimal

        # --- Data / record gaps (shortages in the application) ---
        if water_dec is None or water_dec <= 0:
            gaps.append(
                _gap(
                    code="missing_water_area",
                    category="data",
                    severity="critical",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** জলের ক্ষেত্রফল (ডেসিমাল) নেই — ঘনত্ব (কেজি/ডেসিমাল) হিসাব করা যায় না।",
                    fix_bn="পোন্ড সেটিংসে water area decimal পূরণ করুন।",
                    erp_path="/aquaculture/ponds",
                    metric="water_area_decimal",
                )
            )
            add_fix(
                _fix(
                    action="set_pond_water_area",
                    label_bn=f"{pname}: জলের ক্ষেত্রফল (ডেসিমাল) ERP-তে দিন",
                    erp_path="/aquaculture/ponds",
                    pond_id=pond.id,
                    priority=1,
                )
            )

        if pond.pond_depth_ft is None or pond.pond_depth_ft <= 0:
            gaps.append(
                _gap(
                    code="missing_pond_depth",
                    category="data",
                    severity="medium",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** গড় গভীরতা (ফুট) নেই — WorldFish ফিডিং পরামর্শে আয়তন/লোড সঠিক হয় না।",
                    fix_bn="পোন্ড প্রোফাইলে গভীরতা (ft) যোগ করুন।",
                    erp_path="/aquaculture/ponds",
                )
            )

        if pond.id not in active_cycles and biomass > 0:
            gaps.append(
                _gap(
                    code="missing_active_cycle",
                    category="data",
                    severity="medium",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** সক্রিয় স্টকিং ব্যাচ নেই — FCR ও বৃদ্ধি ট্র্যাকিং দুর্বল।",
                    fix_bn="স্টকিং ব্যাচ (production cycle) খুলুন।",
                    erp_path="/aquaculture/cycles",
                )
            )
            add_fix(
                _fix(
                    action="open_production_cycle",
                    label_bn=f"{pname}: স্টকিং ব্যাচ খুলুন",
                    erp_path="/aquaculture/cycles",
                    pond_id=pond.id,
                    priority=2,
                )
            )

        sample = latest_sample.get(pond.id)
        if sample is None and biomass > 0:
            gaps.append(
                _gap(
                    code="no_biomass_sample",
                    category="data",
                    severity="high",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** বায়োমাস স্যাম্পল নেই — ADG/WorldFish ফিড স্টেজ (fingerling/grower/finisher) নির্ণয় হয় না।",
                    fix_bn="বায়োমাস স্যাম্পলিং রেকর্ড করুন (ওজন, মাছের সংখ্যা)।",
                    erp_path="/aquaculture/sampling",
                    metric="biomass_sample",
                )
            )
            add_fix(
                _fix(
                    action="record_biomass_sample",
                    label_bn=f"{pname}: বায়োমাস স্যাম্পল রেকর্ড করুন",
                    erp_path="/aquaculture/sampling",
                    pond_id=pond.id,
                    priority=1,
                )
            )
        elif sample and sample.sample_date < stale_cutoff and biomass > 0:
            gaps.append(
                _gap(
                    code="stale_biomass_sample",
                    category="data",
                    severity="medium",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=(
                        f"**{pname}:** সর্বশেষ স্যাম্পল {sample.sample_date} — "
                        f"{sample_stale_days} দিনের বেশি পুরনো; WorldFish ফিড/বৃদ্ধি হার আপডেট করুন।"
                    ),
                    fix_bn="নতুন বায়োমাস স্যাম্পল নিন।",
                    erp_path="/aquaculture/sampling",
                )
            )
            add_fix(
                _fix(
                    action="refresh_biomass_sample",
                    label_bn=f"{pname}: নতুন বায়োমাস স্যাম্পল নিন (পুরনো {sample.sample_date})",
                    erp_path="/aquaculture/sampling",
                    pond_id=pond.id,
                    priority=2,
                )
            )

        if biomass > 0 and fish_count <= 0:
            gaps.append(
                _gap(
                    code="missing_fish_count",
                    category="data",
                    severity="high",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** বায়োমাস আছে কিন্তু মাছের সংখ্যা নেই — ঘনত্ব/হারভেস্ট পরিকল্পনা অসম্পূর্ণ।",
                    fix_bn="স্যাম্পল বা স্টক লেজারে মাছের সংখ্যা আপডেট করুন।",
                    erp_path="/aquaculture/sampling",
                )
            )

        if biomass <= 0 and fish_count > 0:
            gaps.append(
                _gap(
                    code="missing_biomass_weight",
                    category="data",
                    severity="medium",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** মাছের সংখ্যা আছে কিন্তু বায়োমাস (কেজি) নেই — ঘনত্ব হিসাব করা যায় না।",
                    fix_bn="বায়োমাস স্যাম্পল বা স্টক পজিশন আপডেট করুন।",
                    erp_path="/aquaculture/sampling",
                )
            )

        if not has_any_fish_sale and not company_avg_sale and biomass > 0:
            gaps.append(
                _gap(
                    code="no_fish_sale_reference",
                    category="data",
                    severity="medium",
                    pond_id=pond.id,
                    pond_name=pname,
                    message_bn=f"**{pname}:** কোনো মাছ বিক্রয় রেকর্ড নেই — আনুমানিক বাজার মূল্য/হারভেস্ট আয় হিসাব করা যায় না।",
                    fix_bn="পোন্ড মাছ বিক্রয় রেকর্ড করুন (কেজি, দর)।",
                    erp_path="/aquaculture/sales",
                )
            )
            add_fix(
                _fix(
                    action="record_fish_sale",
                    label_bn="মাছ বিক্রয় রেকর্ড করুন — ভবিষ্যৎ মূল্যায়নের জন্য",
                    erp_path="/aquaculture/sales",
                    priority=2,
                )
            )

        # --- Performance gaps vs WorldFish / FAO benchmarks ---
        kpd_raw = stock.get("stock_density_kg_per_decimal")
        density_val: float | None = None
        if kpd_raw not in (None, ""):
            try:
                density_val = float(str(kpd_raw).replace(",", ""))
            except (TypeError, ValueError):
                pass
        elif water_dec and water_dec > 0 and biomass > 0:
            density_val = float(biomass / water_dec)

        if density_val is not None:
            status = _status_vs_range(
                density_val,
                low_below=density_bench["low_below"],
                optimal_min=density_bench["optimal_min"],
                optimal_max=density_bench["optimal_max"],
                high_above=density_bench["high_above"],
                critical_above=density_bench["critical_above"],
            )
            if status == "below_standard":
                gaps.append(
                    _gap(
                        code="density_understocked",
                        category="performance",
                        severity="medium",
                        pond_id=pond.id,
                        pond_name=pname,
                        message_bn=(
                            f"**{pname}:** ঘনত্ব {density_val:.1f} কেজি/ডেসিমাল — WorldFish সেমি-ইনটেনসিভ "
                            f"লক্ষ্য {density_bench['optimal_min']}–{density_bench['optimal_max']} এর নিচে; "
                            f"উৎপাদন কম ব্যবহার করছে।"
                        ),
                        fix_bn="স্টকিং বাড়ানো বা বৃদ্ধি পরিকল্পনা করুন (লোড অনুযায়ী)।",
                        erp_path="/aquaculture/stock",
                        metric="density_kg_per_decimal",
                        your_value=round(density_val, 2),
                        benchmark=f"{density_bench['optimal_min']}–{density_bench['optimal_max']}",
                    )
                )
            elif status in ("high_risk", "critical"):
                gaps.append(
                    _gap(
                        code="density_overloaded",
                        category="performance",
                        severity="high",
                        pond_id=pond.id,
                        pond_name=pname,
                        message_bn=(
                            f"**{pname}:** ঘনত্ব {density_val:.1f} কেজি/ডেসিমাল — WorldFish/FAO গাইডের "
                            f"সুরক্ষিত সীমা ({density_bench['optimal_max']}+) অতিক্রম; DO/রোগ ঝুঁকি।"
                        ),
                        fix_bn="আংশিক হারভেস্ট/বিক্রি করে লোড কমান।",
                        erp_path="/aquaculture/sales",
                        metric="density_kg_per_decimal",
                        your_value=round(density_val, 2),
                        benchmark=f"≤{density_bench['optimal_max']} optimal",
                    )
                )
                add_fix(
                    _fix(
                        action="partial_harvest",
                        label_bn=f"{pname}: আংশিক হারভেস্ট/বিক্রি — ঘনত্ব কমান",
                        erp_path="/aquaculture/sales",
                        pond_id=pond.id,
                        priority=1,
                        requires_approval=True,
                    )
                )

        load_level = (stock.get("load_level") or "").strip().lower()
        if load_level in ("full", "high_risk") and density_val is not None:
            add_fix(
                _fix(
                    action="review_feeding",
                    label_bn=f"{pname}: WorldFish ফিডিং পরামর্শ দেখুন (লোড: {load_level})",
                    erp_path="/aquaculture/feeding",
                    pond_id=pond.id,
                    priority=2,
                )
            )

    # Portfolio-level FCR gaps from performance summary
    perf = all_ponds_summary(company_id, lang=lang, days=30)
    for row in perf.get("ponds") or []:
        pname = row.get("pond_name")
        pid = row.get("pond_id")
        fcr_raw = row.get("fcr_biomass")
        try:
            fcr_val = float(fcr_raw) if fcr_raw not in (None, "", "—") else None
        except (TypeError, ValueError):
            fcr_val = None
        if fcr_val is None:
            continue
        status = _status_vs_range(
            fcr_val,
            excellent_max=fcr_bench["excellent_max"],
            good_max=fcr_bench["good_max"],
            poor_above=fcr_bench["poor_above"],
        )
        if status in ("poor", "critical", "high_risk", "review"):
            gaps.append(
                _gap(
                    code="fcr_above_worldfish",
                    category="performance",
                    severity="medium",
                    pond_id=pid,
                    pond_name=pname,
                    message_bn=(
                        f"**{pname}:** FCR {fcr_val} — WorldFish/FAO ভালো মান "
                        f"{fcr_bench['excellent_max']}–{fcr_bench['good_max']}; ফিড দক্ষতা দুর্বল।"
                    ),
                    fix_bn="ফিডিং রেট, স্যাম্পল, জলমান ও ঘনত্ব WorldFish গাইড অনুযায়ী ঠিক করুন।",
                    erp_path="/aquaculture/feeding",
                    metric="fcr_biomass",
                    your_value=fcr_val,
                    benchmark=f"{fcr_bench['excellent_max']}–{fcr_bench['good_max']}",
                )
            )
            add_fix(
                _fix(
                    action="improve_fcr",
                    label_bn=f"{pname}: ফিডিং/ঘনত্ব WorldFish মান অনুযায়ী পর্যালোচনা",
                    erp_path="/aquaculture/feeding",
                    pond_id=pid,
                    priority=2,
                    requires_approval=True,
                )
            )

    fixes.sort(key=lambda x: (x.get("priority", 99), x.get("label_bn", "")))
    data_gaps = sum(1 for g in gaps if g.get("category") == "data")
    perf_gaps = sum(1 for g in gaps if g.get("category") == "performance")
    critical = sum(1 for g in gaps if g.get("severity") == "critical")

    if gaps:
        summary_bn = (
            f"WorldFish/FAO যাচাই: **{len(gaps)}**টি ঘাটতি/গ্যাপ "
            f"(ডেটা {data_gaps}, পারফরম্যান্স {perf_gaps}"
            + (f", জরুরি {critical}" if critical else "")
            + f") — **{len(fixes)}**টি ERP-তে ঠিক করার পদক্ষেপ।"
        )
    else:
        summary_bn = (
            "WorldFish/FAO যাচাই: গুরুত্বপূর্ণ ডেটা ও ঘনত্ব/FCR সীমার মধ্যে কোনো বড় গ্যাপ পাওয়া যায়নি। "
            "নিয়মিত স্যাম্পল ও ফিডিং মনিটর চালিয়ে যান।"
        )

    return {
        "generated_at": timezone.now().isoformat(),
        "source_bn": "FAO/WorldFish টিলাপিয়া সংস্কৃতি ও FSERP WorldFish-স্টাইল ফিডিং গাইড",
        "reference_url": "https://digitalarchive.worldfishcenter.org/",
        "pond_count": len(ponds),
        "gap_count": len(gaps),
        "fix_count": len(fixes),
        "counts": {
            "data_gaps": data_gaps,
            "performance_gaps": perf_gaps,
            "critical": critical,
        },
        "summary_bn": summary_bn,
        "gaps": gaps[:24],
        "fixes": fixes[:16],
        "benchmarks_used": {
            "fcr_tilapia": fcr_bench,
            "density_kg_per_decimal": density_bench,
        },
    }
