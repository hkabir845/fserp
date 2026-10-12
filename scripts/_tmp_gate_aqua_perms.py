"""One-shot: add require_aquaculture_module write gates to aquaculture_views.py."""
from __future__ import annotations

import re
from pathlib import Path

WRITE = '("POST", "PUT", "PATCH", "DELETE")'

GATES = {
    "aquaculture_production_cycles_list_or_create": "app.aquaculture.cycles",
    "aquaculture_production_cycle_detail": "app.aquaculture.cycles",
    "aquaculture_ponds_list_or_create": "app.aquaculture.ponds",
    "aquaculture_ponds_create_site_pair": "app.aquaculture.ponds",
    "aquaculture_ponds_provision_pos_customers": "app.aquaculture.ponds",
    "aquaculture_ponds_opening_balances": "app.aquaculture.ponds",
    "aquaculture_medicine_catalog_ensure": "app.aquaculture.medicine",
    "aquaculture_pond_detail": "app.aquaculture.ponds",
    "aquaculture_expenses_list_or_create": "app.aquaculture.expenses",
    "aquaculture_shop_stock_issue": "app.aquaculture.expenses",
    "aquaculture_pond_warehouse_transfer": "app.aquaculture.expenses",
    "aquaculture_pond_warehouse_return": "app.aquaculture.expenses",
    "aquaculture_pond_warehouse_consume": "app.aquaculture.expenses",
    "aquaculture_warehouse_groups_list_or_create": "app.aquaculture.expenses",
    "aquaculture_warehouse_group_detail": "app.aquaculture.expenses",
    "aquaculture_pond_warehouse_inter_pond_transfers": "app.aquaculture.expenses",
    "aquaculture_pond_warehouse_inter_pond_transfer_detail": "app.aquaculture.expenses",
    "aquaculture_expense_detail": "app.aquaculture.expenses",
    "aquaculture_sales_list_or_create": "app.aquaculture.sales",
    "aquaculture_sale_detail": "app.aquaculture.sales",
    "aquaculture_sale_finalize": "app.aquaculture.sales",
    "aquaculture_samples_list_or_create": "app.aquaculture.sampling",
    "aquaculture_sample_detail": "app.aquaculture.sampling",
    "aquaculture_fish_stock_ledger_list_or_create": "app.aquaculture.stock",
    "aquaculture_fish_stock_ledger_detail": "app.aquaculture.stock",
    "aquaculture_pond_profit_transfers": "app.aquaculture.expenses",
    "aquaculture_fish_pond_transfers": "app.aquaculture.sales",
    "aquaculture_fish_pond_transfer_detail": "app.aquaculture.sales",
    "aquaculture_feeding_advice_generate": "app.aquaculture.feeding",
    "aquaculture_feeding_advice_detail": "app.aquaculture.feeding",
    "aquaculture_feeding_advice_approve": "app.aquaculture.feeding",
    "aquaculture_feeding_advice_disapprove": "app.aquaculture.feeding",
    "aquaculture_feeding_advice_cancel": "app.aquaculture.feeding",
    "aquaculture_feeding_advice_apply": "app.aquaculture.feeding",
    "aquaculture_landlords_list_or_create": "app.aquaculture.landlords",
    "aquaculture_landlord_detail": "app.aquaculture.landlords",
    "aquaculture_landlord_ledger_create": "app.aquaculture.landlords",
    "aquaculture_landlord_ledger_entry_detail": "app.aquaculture.landlords",
}


def main() -> None:
    path = Path(__file__).resolve().parents[1] / "backend" / "api" / "views" / "aquaculture_views.py"
    text = path.read_text(encoding="utf-8")

    m = re.search(r"from api\.views\.common import ([^\n]+)", text)
    if not m:
        raise SystemExit("import not found")
    imps = m.group(1)
    if "require_aquaculture_module" not in imps:
        new_imps = imps.rstrip()
        if new_imps.endswith(","):
            new_imps = new_imps + " require_aquaculture_module"
        else:
            new_imps = new_imps + ", require_aquaculture_module"
        text = text[: m.start(1)] + new_imps + text[m.end(1) :]

    added = 0
    missing: list[str] = []
    for fn, mod in GATES.items():
        deco = f'@require_aquaculture_module("{mod}", methods={WRITE})'
        pat = rf"((?:@[^\n]+\n)+)def {fn}\("
        mm = re.search(pat, text)
        if not mm:
            missing.append(fn)
            continue
        block = mm.group(1)
        if "require_aquaculture_module" in block:
            continue
        new_block = block.rstrip("\n") + "\n" + deco + "\n"
        text = text[: mm.start(1)] + new_block + text[mm.end(1) :]
        added += 1

    path.write_text(text, encoding="utf-8")
    print(f"added={added} missing={missing}")


if __name__ == "__main__":
    main()
