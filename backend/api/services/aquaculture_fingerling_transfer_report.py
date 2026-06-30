"""
Fingerling transfer report: nursing pond → grow-out with cost split and reconciliation.

Purchase cost = proportional fry_stocking share; other expenses = feed, medicine, preparation, etc.
Total line cost = receiving pond biological liability (matches nursing pond transfer-out credit).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from django.db import models

from api.models import AquacultureFishPondTransfer, AquaculturePond
from api.services.aquaculture_constants import fish_species_display_label
from api.services.aquaculture_transfer_cost import (
    backfill_missing_transfer_line_costs,
    split_transfer_line_cost_amount,
    transfer_cost_pools_for_scope,
)


@dataclass(frozen=True)
class FingerlingTransferReportFilters:
    search_q: str = ""
    species: str = ""
    min_cost: Decimal | None = None
    max_cost: Decimal | None = None
    nursing_pond_id: int | None = None
    growout_pond_id: int | None = None
    balance: str = "all"  # all | balanced | unbalanced


def parse_fingerling_transfer_report_filters(
    *,
    search_q: str | None = None,
    species: str | None = None,
    min_cost_raw: str | None = None,
    max_cost_raw: str | None = None,
    nursing_pond_id_raw: str | None = None,
    growout_pond_id_raw: str | None = None,
    balance: str | None = None,
) -> FingerlingTransferReportFilters:
    def _dec(raw: str | None) -> Decimal | None:
        if raw in (None, ""):
            return None
        try:
            return Decimal(str(raw).strip())
        except (InvalidOperation, ValueError):
            return None

    def _pid(raw: str | None) -> int | None:
        if raw in (None, ""):
            return None
        s = str(raw).strip()
        return int(s) if s.isdigit() else None

    bal = (balance or "all").strip().lower()
    if bal not in ("all", "balanced", "unbalanced"):
        bal = "all"

    return FingerlingTransferReportFilters(
        search_q=(search_q or "").strip(),
        species=(species or "").strip().lower(),
        min_cost=_dec(min_cost_raw),
        max_cost=_dec(max_cost_raw),
        nursing_pond_id=_pid(nursing_pond_id_raw),
        growout_pond_id=_pid(growout_pond_id_raw),
        balance=bal,
    )


def _money_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _kg_q(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _pond_role_label(role: str | None) -> str:
    r = (role or "grow_out").strip().lower()
    if r == "nursing":
        return "Nursing"
    if r == "grow_out":
        return "Grow-out"
    return r.replace("_", " ").title()


def _source_cost_split(
    company_id: int,
    *,
    from_pond_id: int,
    from_cycle,
    transfer_date: date,
) -> tuple[Decimal, Decimal]:
    return transfer_cost_pools_for_scope(
        company_id=company_id,
        from_pond_id=from_pond_id,
        transfer_date=transfer_date,
        from_cycle=from_cycle,
    )


def _split_line_cost(
    line_cost: Decimal,
    fry_pool: Decimal,
    other_pool: Decimal,
) -> tuple[Decimal, Decimal]:
    return split_transfer_line_cost_amount(line_cost, fry_pool, other_pool)


def _pcs_per_kg(fish_count: int | None, weight_kg: Decimal, stored_pcs: Decimal | None) -> str | None:
    if stored_pcs is not None and stored_pcs > 0:
        return str(_kg_q(stored_pcs))
    if fish_count and fish_count > 0 and weight_kg > 0:
        return str(_kg_q(Decimal(fish_count) / weight_kg))
    return None


def _search_blob(row: dict[str, Any]) -> str:
    parts = [
        row.get("transfer_date") or "",
        row.get("from_pond_name") or "",
        row.get("from_cycle_name") or "",
        row.get("to_pond_name") or "",
        row.get("to_cycle_name") or "",
        row.get("fish_species_label") or "",
        row.get("fish_species") or "",
        row.get("memo") or "",
        str(row.get("transfer_id") or ""),
        str(row.get("line_id") or ""),
    ]
    return " ".join(p for p in parts if p).lower()


def _statement_line_matches(row: dict[str, Any], filters: FingerlingTransferReportFilters) -> bool:
    cost = Decimal(str(row.get("total_cost") or 0))
    if filters.min_cost is not None and cost < filters.min_cost:
        return False
    if filters.max_cost is not None and cost > filters.max_cost:
        return False
    if filters.nursing_pond_id is not None and int(row.get("from_pond_id") or 0) != filters.nursing_pond_id:
        return False
    if filters.growout_pond_id is not None and int(row.get("to_pond_id") or 0) != filters.growout_pond_id:
        return False
    if filters.species:
        sp = (row.get("fish_species") or "").strip().lower()
        if sp != filters.species:
            return False
    if filters.search_q:
        q = filters.search_q.lower()
        if q not in _search_blob(row):
            return False
    return True


def _transfer_matches_balance(transfer: dict[str, Any], filters: FingerlingTransferReportFilters) -> bool:
    if filters.balance == "balanced":
        return bool(transfer.get("transfer_balanced"))
    if filters.balance == "unbalanced":
        return not bool(transfer.get("transfer_balanced"))
    return True


def _summaries_from_statement(
    statement_lines: list[dict[str, Any]], company_id: int
) -> tuple[list[dict], list[dict], dict]:
    nursing_agg: dict[int, dict[str, Any]] = defaultdict(
        lambda: {
            "fish_count": 0,
            "weight_kg": Decimal("0"),
            "purchase_cost": Decimal("0"),
            "other_expenses": Decimal("0"),
            "total_cost": Decimal("0"),
        }
    )
    growout_agg: dict[int, dict[str, Any]] = defaultdict(
        lambda: {
            "fish_count": 0,
            "weight_kg": Decimal("0"),
            "purchase_cost": Decimal("0"),
            "other_expenses": Decimal("0"),
            "total_liability": Decimal("0"),
        }
    )
    grand_fish = 0
    grand_wt = Decimal("0")
    grand_purchase = Decimal("0")
    grand_other = Decimal("0")
    grand_total = Decimal("0")

    for row in statement_lines:
        fc = int(row.get("fish_count") or 0)
        wt = Decimal(str(row.get("weight_kg") or 0))
        purchase = Decimal(str(row.get("purchase_cost") or 0))
        other = Decimal(str(row.get("other_expenses_cost") or 0))
        cost = Decimal(str(row.get("total_cost") or 0))
        fpid = int(row.get("from_pond_id") or 0)
        tpid = int(row.get("to_pond_id") or 0)
        if fpid:
            n = nursing_agg[fpid]
            n["fish_count"] += fc
            n["weight_kg"] += wt
            n["purchase_cost"] += purchase
            n["other_expenses"] += other
            n["total_cost"] += cost
        if tpid:
            g = growout_agg[tpid]
            g["fish_count"] += fc
            g["weight_kg"] += wt
            g["purchase_cost"] += purchase
            g["other_expenses"] += other
            g["total_liability"] += cost
        grand_fish += fc
        grand_wt += wt
        grand_purchase += purchase
        grand_other += other
        grand_total += cost

    pond_names = {
        p.id: (p.name or "").strip()
        for p in AquaculturePond.objects.filter(
            pk__in=list(nursing_agg.keys()) + list(growout_agg.keys()),
            company_id=company_id,
        )
    }

    nursing_summary = []
    for pid, agg in sorted(nursing_agg.items(), key=lambda x: pond_names.get(x[0], "")):
        nursing_summary.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond {pid}"),
                "pond_role": "nursing",
                "fish_count_out": agg["fish_count"],
                "weight_kg_out": str(_kg_q(agg["weight_kg"])),
                "purchase_cost_out": str(_money_q(agg["purchase_cost"])),
                "other_expenses_out": str(_money_q(agg["other_expenses"])),
                "total_cost_out": str(_money_q(agg["total_cost"])),
            }
        )

    growout_summary = []
    for pid, agg in sorted(growout_agg.items(), key=lambda x: pond_names.get(x[0], "")):
        growout_summary.append(
            {
                "pond_id": pid,
                "pond_name": pond_names.get(pid, f"Pond {pid}"),
                "pond_role": "grow_out",
                "fish_count_in": agg["fish_count"],
                "weight_kg_in": str(_kg_q(agg["weight_kg"])),
                "purchase_cost_in": str(_money_q(agg["purchase_cost"])),
                "other_expenses_in": str(_money_q(agg["other_expenses"])),
                "total_liability_in": str(_money_q(agg["total_liability"])),
            }
        )

    nursing_total = _money_q(
        sum((Decimal(r["total_cost_out"]) for r in nursing_summary), Decimal("0"))
    )
    growout_total = _money_q(
        sum((Decimal(r["total_liability_in"]) for r in growout_summary), Decimal("0"))
    )
    diff = _money_q(nursing_total - growout_total)

    totals = {
        "transfer_count": len({r["transfer_id"] for r in statement_lines}),
        "line_count": len(statement_lines),
        "fish_count": grand_fish,
        "weight_kg": str(_kg_q(grand_wt)),
        "purchase_cost": str(_money_q(grand_purchase)),
        "other_expenses": str(_money_q(grand_other)),
        "total_cost": str(_money_q(grand_total)),
    }
    reconciliation = {
        "nursing_total_cost_out": str(nursing_total),
        "growout_total_liability_in": str(growout_total),
        "balanced": diff == 0,
        "difference": str(diff),
    }
    return nursing_summary, growout_summary, {"totals": totals, "reconciliation": reconciliation}


def compute_fingerling_transfer_report(
    company_id: int,
    *,
    start: date,
    end: date,
    pond_filter_id: int | None = None,
    filters: FingerlingTransferReportFilters | None = None,
) -> dict[str, Any]:
    flt = filters or FingerlingTransferReportFilters()
    qs = (
        AquacultureFishPondTransfer.objects.filter(
            company_id=company_id,
            transfer_date__gte=start,
            transfer_date__lte=end,
            from_pond__pond_role="nursing",
        )
        .select_related("from_pond", "from_production_cycle")
        .prefetch_related("lines__to_pond", "lines__to_production_cycle")
        .order_by("transfer_date", "id")
    )
    if pond_filter_id is not None:
        qs = qs.filter(
            models.Q(from_pond_id=pond_filter_id)
            | models.Q(lines__to_pond_id=pond_filter_id)
        ).distinct()

    all_statement: list[dict[str, Any]] = []
    species_set: set[str] = set()

    for xfer in qs:
        backfill_missing_transfer_line_costs(xfer)
        fry_pool, other_pool = _source_cost_split(
            company_id,
            from_pond_id=xfer.from_pond_id,
            from_cycle=xfer.from_production_cycle,
            transfer_date=xfer.transfer_date,
        )
        sp = getattr(xfer, "fish_species", None) or "tilapia"
        spo = getattr(xfer, "fish_species_other", None) or ""
        sp_label = fish_species_display_label(sp, spo)
        species_set.add(sp.strip().lower())

        from_pond = xfer.from_pond
        from_name = (from_pond.name or "").strip() if from_pond else ""
        from_cycle_name = (
            (xfer.from_production_cycle.name or "").strip()
            if xfer.from_production_cycle_id
            else ""
        )
        created_at = xfer.created_at.isoformat() if getattr(xfer, "created_at", None) else None

        for ln in xfer.lines.all():
            wt = ln.weight_kg or Decimal("0")
            cost = _money_q(ln.cost_amount or Decimal("0"))
            fc = int(ln.fish_count or 0)
            purchase, other = _split_line_cost(cost, fry_pool, other_pool)
            pcs = _pcs_per_kg(fc if fc > 0 else None, wt, ln.pcs_per_kg)

            to_pond = ln.to_pond
            to_name = (to_pond.name or "").strip() if to_pond else ""
            to_role = getattr(to_pond, "pond_role", None) if to_pond else None
            to_cycle_name = (
                (ln.to_production_cycle.name or "").strip()
                if ln.to_production_cycle_id
                else ""
            )

            all_statement.append(
                {
                    "transfer_id": xfer.id,
                    "line_id": ln.id,
                    "transfer_date": xfer.transfer_date.isoformat(),
                    "created_at": created_at,
                    "from_pond_id": xfer.from_pond_id,
                    "from_pond_name": from_name,
                    "from_cycle_name": from_cycle_name,
                    "fish_species": sp,
                    "fish_species_label": sp_label,
                    "memo": (xfer.memo or "")[:300],
                    "to_pond_id": ln.to_pond_id,
                    "to_pond_name": to_name,
                    "to_pond_role": to_role or "",
                    "to_pond_role_label": _pond_role_label(to_role),
                    "to_cycle_name": to_cycle_name,
                    "fish_count": fc if fc > 0 else None,
                    "weight_kg": str(_kg_q(wt)) if wt > 0 else "0",
                    "pcs_per_kg": pcs,
                    "purchase_cost": str(purchase),
                    "other_expenses_cost": str(other),
                    "total_cost": str(cost),
                    "receiving_pond_liability": str(cost),
                }
            )

    statement_lines = [r for r in all_statement if _statement_line_matches(r, flt)]

    transfers_out: list[dict[str, Any]] = []
    by_transfer: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in statement_lines:
        by_transfer[int(row["transfer_id"])].append(row)

    for tid, lines in sorted(by_transfer.items(), key=lambda x: (x[1][0]["transfer_date"], x[0])):
        first = lines[0]
        xfer_purchase = _money_q(sum(Decimal(l["purchase_cost"]) for l in lines))
        xfer_other = _money_q(sum(Decimal(l["other_expenses_cost"]) for l in lines))
        xfer_total = _money_q(sum(Decimal(l["total_cost"]) for l in lines))
        growout_in = xfer_total
        nursing_out = xfer_total
        transfer_row = {
            "transfer_id": tid,
            "transfer_date": first["transfer_date"],
            "created_at": first.get("created_at"),
            "from_pond_id": first["from_pond_id"],
            "from_pond_name": first["from_pond_name"],
            "from_pond_role": "nursing",
            "from_cycle_name": first.get("from_cycle_name") or "",
            "fish_species": first["fish_species"],
            "fish_species_label": first["fish_species_label"],
            "memo": first.get("memo") or "",
            "lines": [
                {
                    "line_id": l["line_id"],
                    "to_pond_id": l["to_pond_id"],
                    "to_pond_name": l["to_pond_name"],
                    "to_pond_role": l["to_pond_role"],
                    "to_pond_role_label": l["to_pond_role_label"],
                    "to_cycle_name": l.get("to_cycle_name") or "",
                    "fish_count": l["fish_count"],
                    "weight_kg": l["weight_kg"],
                    "pcs_per_kg": l["pcs_per_kg"],
                    "purchase_cost": l["purchase_cost"],
                    "other_expenses_cost": l["other_expenses_cost"],
                    "total_cost": l["total_cost"],
                    "receiving_pond_liability": l["receiving_pond_liability"],
                }
                for l in lines
            ],
            "nursing_cost_out": str(nursing_out),
            "growout_liability_in": str(growout_in),
            "transfer_balanced": nursing_out == growout_in,
            "line_count": len(lines),
        }
        if _transfer_matches_balance(transfer_row, flt):
            transfers_out.append(transfer_row)

    filtered_statement = []
    kept_transfer_ids = {t["transfer_id"] for t in transfers_out}
    for row in statement_lines:
        if int(row["transfer_id"]) in kept_transfer_ids:
            filtered_statement.append(row)

    nursing_summary, growout_summary, agg = _summaries_from_statement(filtered_statement, company_id)

    return {
        "report_note": (
            "Fingerling moves from nursing ponds only. Purchase cost is the fry/fingerling share; "
            "other expenses are feed, medicine, preparation, and direct production costs accumulated "
            "on the nursing pond before transfer. Total cost on each line is the biological liability "
            "recorded on the receiving grow-out pond. Nursing transfer-out and grow-out liability-in "
            "must match in total."
        ),
        "filters_applied": {
            "search_q": flt.search_q,
            "species": flt.species,
            "min_cost": str(flt.min_cost) if flt.min_cost is not None else "",
            "max_cost": str(flt.max_cost) if flt.max_cost is not None else "",
            "nursing_pond_id": flt.nursing_pond_id,
            "growout_pond_id": flt.growout_pond_id,
            "balance": flt.balance,
        },
        "species_options": sorted(species_set),
        "statement_lines": filtered_statement,
        "transfers": transfers_out,
        "nursing_summary": nursing_summary,
        "growout_summary": growout_summary,
        "reconciliation": agg["reconciliation"],
        "totals": agg["totals"],
    }
