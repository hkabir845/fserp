"""
Unified, read-only "everything that moved fish biomass" ledger.

Aggregates rows from four real sources (no new table):
  - vendor_bill: posted vendor bills with pond-tagged fish lines (stocking from outside).
  - transfer_in / transfer_out: AquacultureFishPondTransfer lines (inter-pond moves).
  - sale: AquacultureFishSale rows (excludes non-biological income types).
  - ledger_loss / ledger_adjustment: AquacultureFishStockLedger rows
    (mortality, predators, theft, manual count/weight adjustments).

Sums per pond match compute_fish_stock_position_rows().
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

from api.models import (
    AquacultureFishPondTransferLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquaculturePond,
    BillLine,
    Item,
)
from api.services.aquaculture_constants import (
    STOCK_LEDGER_ENTRY_KIND_LABELS,
    STOCK_LEDGER_LOSS_REASON_LABELS,
    fish_species_display_label,
    normalize_fish_species,
)
from api.services.tenant_reporting_categories import income_type_is_non_biological_for_company
from api.services.aquaculture_stock_service import (
    _bill_line_matches_species_filter,
    _bill_line_species_code,
)


SOURCE_LABELS: dict[str, str] = {
    "vendor_bill": "Stocking (vendor bill)",
    "transfer_in": "Transfer in",
    "transfer_out": "Transfer out",
    "sale": "Sale",
    "ledger_loss": "Loss / mortality",
    "ledger_adjustment": "Manual adjustment",
}


def _d(v) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def _pond_name_map(company_id: int, pond_ids: Iterable[int]) -> dict[int, str]:
    ids = {int(p) for p in pond_ids if p is not None}
    if not ids:
        return {}
    out: dict[int, str] = {}
    for p in AquaculturePond.objects.filter(company_id=company_id, pk__in=ids).only("id", "name"):
        out[p.id] = (p.name or "").strip() or f"Pond #{p.id}"
    return out


def _date_in_range(d: date, df: date | None, dt: date | None) -> bool:
    if df is not None and d < df:
        return False
    if dt is not None and d > dt:
        return False
    return True


def compute_fish_biomass_ledger_rows(
    company_id: int,
    *,
    pond_id: int | None = None,
    production_cycle_id: int | None = None,
    fish_species_filter: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sources: frozenset[str] | None = None,
    limit: int = 500,
) -> list[dict]:
    """Return chronological (newest first) rows across all biomass-affecting sources."""
    cid = company_id
    species_code: str | None = None
    if fish_species_filter is not None and str(fish_species_filter).strip() != "":
        species_code, _ = normalize_fish_species(fish_species_filter)

    want = sources or frozenset(SOURCE_LABELS.keys())
    rows: list[dict] = []

    # Inter-pond transfers (one source row produces one or two ledger rows: out + in[s]).
    if "transfer_in" in want or "transfer_out" in want:
        tlq = AquacultureFishPondTransferLine.objects.filter(
            transfer__company_id=cid,
        ).select_related("transfer", "to_pond", "transfer__from_pond")
        for ln in tlq:
            tr = ln.transfer
            if not _date_in_range(tr.transfer_date, date_from, date_to):
                continue
            if species_code is not None:
                sp, _err = normalize_fish_species(getattr(tr, "fish_species", None))
                if sp != species_code:
                    continue
            sp_code, _ = normalize_fish_species(getattr(tr, "fish_species", None))
            sp_label = fish_species_display_label(
                getattr(tr, "fish_species", None), getattr(tr, "fish_species_other", None)
            )
            wkg = _d(ln.weight_kg)
            fc = int(ln.fish_count or 0)
            value = _d(ln.cost_amount)
            base = {
                "entry_date": tr.transfer_date.isoformat(),
                "source_id": tr.id,
                "source_doc": f"Transfer #{tr.id}",
                "fish_species": sp_code,
                "fish_species_label": sp_label,
                "loss_reason": "",
                "loss_reason_label": None,
                "value_amount": str(value),
                "memo": (tr.memo or "").strip(),
                "journal_entry_number": "",
            }
            if "transfer_out" in want:
                fp_id = tr.from_pond_id
                if (pond_id is None or pond_id == fp_id) and (
                    production_cycle_id is None or tr.from_production_cycle_id == production_cycle_id
                ):
                    rows.append(
                        {
                            **base,
                            "source": "transfer_out",
                            "source_label": SOURCE_LABELS["transfer_out"],
                            "pond_id": fp_id,
                            "pond_name": "",
                            "production_cycle_id": tr.from_production_cycle_id,
                            "fish_count_delta": -fc,
                            "weight_kg_delta": str(-wkg),
                        }
                    )
            if "transfer_in" in want:
                tp_id = ln.to_pond_id
                if (pond_id is None or pond_id == tp_id) and (
                    production_cycle_id is None or ln.to_production_cycle_id == production_cycle_id
                ):
                    rows.append(
                        {
                            **base,
                            "source": "transfer_in",
                            "source_label": SOURCE_LABELS["transfer_in"],
                            "pond_id": tp_id,
                            "pond_name": "",
                            "production_cycle_id": ln.to_production_cycle_id,
                            "fish_count_delta": fc,
                            "weight_kg_delta": str(wkg),
                        }
                    )

    # Vendor bill stocking (posted bills with pond-tagged fish lines).
    if "vendor_bill" in want:
        bl_q = (
            BillLine.objects.filter(
                bill__company_id=cid,
                bill__stock_receipt_applied=True,
                aquaculture_pond_id__isnull=False,
                item__isnull=False,
                aquaculture_fish_count__gt=0,
            )
            .filter(item__pos_category__iexact="fish")
            .select_related("item", "bill", "aquaculture_pond")
        )
        if pond_id is not None:
            bl_q = bl_q.filter(aquaculture_pond_id=pond_id)
        if production_cycle_id is not None:
            bl_q = bl_q.filter(aquaculture_production_cycle_id=production_cycle_id)
        for ln in bl_q:
            it: Item = ln.item
            if not it or not _bill_line_matches_species_filter(ln, it, species_code):
                continue
            bd = ln.bill.bill_date
            if not _date_in_range(bd, date_from, date_to):
                continue
            wkg = _d(ln.aquaculture_fish_weight_kg)
            fc = int(ln.aquaculture_fish_count or 0)
            ln_sp_code = _bill_line_species_code(ln, it)
            ln_sp_label = (
                fish_species_display_label(
                    getattr(ln, "aquaculture_fish_species", "") or "",
                    getattr(ln, "aquaculture_fish_species_other", "") or "",
                )
                if (getattr(ln, "aquaculture_fish_species", "") or "")
                else (it.name or "").strip()
            )
            rows.append(
                {
                    "entry_date": bd.isoformat(),
                    "source": "vendor_bill",
                    "source_label": SOURCE_LABELS["vendor_bill"],
                    "source_id": ln.bill_id,
                    "source_doc": f"Bill {ln.bill.bill_number or '#' + str(ln.bill_id)}",
                    "pond_id": ln.aquaculture_pond_id,
                    "pond_name": "",
                    "production_cycle_id": ln.aquaculture_production_cycle_id,
                    "fish_species": ln_sp_code,
                    "fish_species_label": ln_sp_label,
                    "loss_reason": "",
                    "loss_reason_label": None,
                    "fish_count_delta": fc,
                    "weight_kg_delta": str(wkg),
                    "value_amount": str(_d(ln.amount)),
                    "memo": (ln.description or "").strip(),
                    "journal_entry_number": "",
                }
            )

    # Pond fish sales (skip non-biological income types).
    if "sale" in want:
        sq = AquacultureFishSale.objects.filter(company_id=cid).select_related("pond", "production_cycle")
        if pond_id is not None:
            sq = sq.filter(pond_id=pond_id)
        if production_cycle_id is not None:
            sq = sq.filter(production_cycle_id=production_cycle_id)
        for s in sq:
            if income_type_is_non_biological_for_company(cid, getattr(s, "income_type", None) or ""):
                continue
            if species_code is not None:
                sp, _err = normalize_fish_species(getattr(s, "fish_species", None))
                if sp != species_code:
                    continue
            if not _date_in_range(s.sale_date, date_from, date_to):
                continue
            sp_code, _ = normalize_fish_species(getattr(s, "fish_species", None))
            sp_label = fish_species_display_label(
                getattr(s, "fish_species", None), getattr(s, "fish_species_other", None)
            )
            fc = int(s.fish_count or 0)
            wkg = _d(s.weight_kg)
            rows.append(
                {
                    "entry_date": s.sale_date.isoformat(),
                    "source": "sale",
                    "source_label": SOURCE_LABELS["sale"],
                    "source_id": s.id,
                    "source_doc": f"Sale #{s.id}",
                    "pond_id": s.pond_id,
                    "pond_name": "",
                    "production_cycle_id": s.production_cycle_id,
                    "fish_species": sp_code,
                    "fish_species_label": sp_label,
                    "loss_reason": "",
                    "loss_reason_label": None,
                    "fish_count_delta": -fc,
                    "weight_kg_delta": str(-wkg),
                    "value_amount": str(_d(s.total_amount)),
                    "memo": (s.memo or "").strip(),
                    "journal_entry_number": "",
                }
            )

    # Manual ledger rows (mortality, predator, theft, adjustments).
    want_loss = "ledger_loss" in want
    want_adj = "ledger_adjustment" in want
    if want_loss or want_adj:
        lq = AquacultureFishStockLedger.objects.filter(company_id=cid).select_related(
            "pond", "production_cycle", "journal_entry"
        )
        if pond_id is not None:
            lq = lq.filter(pond_id=pond_id)
        if production_cycle_id is not None:
            lq = lq.filter(production_cycle_id=production_cycle_id)
        for x in lq:
            kind = (x.entry_kind or "").strip()
            if kind == "loss" and not want_loss:
                continue
            if kind != "loss" and not want_adj:
                continue
            if species_code is not None:
                sp, _err = normalize_fish_species(getattr(x, "fish_species", None))
                if sp != species_code:
                    continue
            if not _date_in_range(x.entry_date, date_from, date_to):
                continue
            sp_code, _ = normalize_fish_species(getattr(x, "fish_species", None))
            sp_label = fish_species_display_label(x.fish_species, x.fish_species_other)
            lr = (x.loss_reason or "").strip()
            je = x.journal_entry
            src = "ledger_loss" if kind == "loss" else "ledger_adjustment"
            rows.append(
                {
                    "entry_date": x.entry_date.isoformat(),
                    "source": src,
                    "source_label": SOURCE_LABELS[src],
                    "source_id": x.id,
                    "source_doc": STOCK_LEDGER_ENTRY_KIND_LABELS.get(kind, kind),
                    "pond_id": x.pond_id,
                    "pond_name": "",
                    "production_cycle_id": x.production_cycle_id,
                    "fish_species": sp_code,
                    "fish_species_label": sp_label,
                    "loss_reason": lr,
                    "loss_reason_label": STOCK_LEDGER_LOSS_REASON_LABELS.get(lr, "") or None,
                    "fish_count_delta": int(x.fish_count_delta or 0),
                    "weight_kg_delta": str(_d(x.weight_kg_delta)),
                    "value_amount": str(_d(x.book_value)),
                    "memo": (x.memo or "").strip(),
                    "journal_entry_number": (je.entry_number or "").strip() if je else "",
                }
            )

    rows.sort(key=lambda r: (r["entry_date"], r["source_id"]), reverse=True)
    if limit and limit > 0:
        rows = rows[:limit]

    name_map = _pond_name_map(company_id, (r.get("pond_id") for r in rows))
    for r in rows:
        pid = r.get("pond_id")
        r["pond_name"] = name_map.get(int(pid), "") if pid is not None else ""
    return rows
