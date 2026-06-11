"""Aquaculture expense category codes, income line types, and shared-cost rule (API + UI)."""

from __future__ import annotations

# Inter-pond fish transfers (nursing → grow-out): documented on P&L API and transfers UI.
INTER_POND_FISH_TRANSFER_PL_NOTE = (
    "Inter-pond fish transfers: each line can carry cost_amount (same currency as expenses). "
    "Pond P&L treats this as moving biological cost — operating expenses increase on receiving ponds and "
    "decrease on the source pond by the same totals, so company-wide direct costs are unchanged. "
    "Each line requires weight_kg and fish_count (heads), both greater than zero, for production tracking; "
    "pcs_per_kg is optional. Allocate cost_amount from the nursing pond’s fry and nursing-period costs "
    "(for example proportional to kg or your auditor’s rule)."
)

# Pond role (management / UX; not GL).
AQUACULTURE_POND_ROLE_CHOICES: tuple[tuple[str, str], ...] = (
    ("grow_out", "Grow-out"),
    ("nursing", "Nursing / nursery"),
    ("broodstock", "Broodstock"),
    ("other", "Other"),
)

POND_ROLE_CODES: frozenset[str] = frozenset(c for c, _ in AQUACULTURE_POND_ROLE_CHOICES)
POND_ROLE_LABELS: dict[str, str] = {c: label for c, label in AQUACULTURE_POND_ROLE_CHOICES}

# One rule for shared operating costs (documented on P&L API and in admin UI copy).
SHARED_OPERATING_COST_RULE = (
    "Shared operating cost: leave pond empty and provide either pond_shares "
    "[{pond_id, amount}, …] whose amounts sum exactly to the expense total (at least two ponds with positive "
    "amounts), or shared_equal_pond_ids with at least two pond ids (total split in equal cents). "
    "Shared lines cannot be assigned to a production cycle. Direct cost: set pond and omit splits."
)

# Stable keys stored in DB; labels can be shown in UI from this map.
AQUACULTURE_EXPENSE_CATEGORY_CHOICES: tuple[tuple[str, str], ...] = (
    ("lease", "Lease money"),
    ("worker_salary", "Worker salary"),
    ("soilcut", "Soil cut"),
    ("pond_preparation", "Pond preparation"),
    ("fry_stocking", "Fry stocking"),
    ("feed_purchase", "Feed purchase"),
    ("feed_consumed", "Feed consumed (pond warehouse)"),
    ("medicine_consumed", "Medicine consumed (pond warehouse)"),
    ("medicine_purchase", "Medicine purchase"),
    (
        "vendor_bill_pond",
        "Vendor bill (pond-tagged line)",
    ),
    ("electricity", "Electricity"),
    ("equipment", "Equipment (aerators, nets, etc.)"),
    ("repair_maintenance", "Repair & maintenance"),
    ("fisherman", "Fisherman bills"),
    ("transportation", "Transportation"),
    ("shop_supplies", "Shop supplies to pond"),
    ("mortality", "Mortality, predation & shrinkage"),
    ("other", "Miscellaneous"),
)

EXPENSE_CATEGORY_CODES: frozenset[str] = frozenset(c for c, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES)

EXPENSE_CATEGORY_LABELS: dict[str, str] = {c: label for c, label in AQUACULTURE_EXPENSE_CATEGORY_CHOICES}

# POST/PUT /aquaculture/expenses/: manual pond costs deprecated — use vendor bills (see aquaculture_bill_defaults).
_MANUAL_AQUACULTURE_EXPENSE_EXCLUDED: frozenset[str] = frozenset(
    c for c, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES
)
MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES: frozenset[str] = frozenset()


def manual_aquaculture_expense_category_change_allowed(
    *, old_category: str | None, new_category: str
) -> tuple[bool, str | None]:
    """Allow category change when it stays manual, or when the code is unchanged (editing legacy rows)."""
    if new_category in MANUAL_AQUACULTURE_EXPENSE_CATEGORY_CODES:
        return True, None
    if old_category == new_category:
        return True, None
    detail_by_cat: dict[str, str] = {
        "fry_stocking": (
            "Fry and fingerling purchases belong on a vendor bill: use a fish-type line with pond, kg, and head count."
        ),
        "feed_purchase": (
            "Feed purchases belong on vendor bills, Cashier (POS) on account to the pond customer, or the internal "
            "shop-stock-issue flow—not as a typed amount on Add expense."
        ),
        "medicine_purchase": (
            "Medicine purchases belong on vendor bills, POS on account, or internal shop stock issue—not as Add expense."
        ),
        "feed_consumed": (
            "Feed consumption is recorded from the pond warehouse or when feeding advice is applied, not as a manual pond cost."
        ),
        "medicine_consumed": (
            "Medicine consumption is recorded from the pond warehouse flow, not as a manual pond cost."
        ),
        "vendor_bill_pond": "This amount is derived from posted vendor bills with pond-tagged lines.",
        "lease": (
            "Lease cash paid to landlords belongs on Aquaculture → Landlords: use a bank/cash register, pond "
            "allocation, and “applies to lease paid” so 6711 and pond lease_paid stay aligned—not a typed amount here."
        ),
        "worker_salary": (
            "Staff wages belong in HR & payroll: create a payroll run, split net pay across ponds if needed, then "
            "post to books—pond P&L picks up payroll allocations; do not duplicate as a manual pond cost."
        ),
    }
    return False, detail_by_cat.get(
        new_category,
        "This category cannot be selected for manual pond costs.",
    )

# Optional longer copy for UIs (expense-categories API includes hint when present).
EXPENSE_CATEGORY_EXTRA_HELP: dict[str, str] = {
    "lease": (
        "Not offered on Add expense: record cash paid on Aquaculture → Landlords with a bank/cash register and pond "
        "lines (optionally “applies to lease paid”). That posts Dr 6711 lease & pond rights (pond + lease bucket) and "
        "Cr the register, and updates pond lease_paid so obligations stay in one place."
    ),
    "worker_salary": (
        "Not offered on Add expense: use HR & payroll—payroll runs with optional pond allocations feed the labor bucket "
        "on pond P&L when you post salary to the general ledger."
    ),
    "feed_purchase": (
        "Not offered on Add expense: use vendor Bills (pond-tagged lines), Cashier (POS) on account to the pond’s "
        "customer, or Advanced → internal stock issue on this page. Sacks/kg can be set on the stock-issue path."
    ),
    "feed_consumed": (
        "Posted automatically when approved feeding advice is applied and stock is drawn from the pond warehouse "
        "(after transferring feed from a shop station such as Premium Agro). COGS and inventory follow average cost."
    ),
    "medicine_consumed": (
        "Posted when medicine is recorded as used from the pond warehouse (after transferring from a shop station). "
        "Same accounting as feed consumed: Dr COGS / Cr inventory at average cost; tagged to the medicine cost bucket."
    ),
    "medicine_purchase": (
        "Not offered on Add expense: use Bills, POS on account to the pond customer, or internal shop stock issue—"
        "same pattern as feed."
    ),
    "vendor_bill_pond": (
        "Automatic: expense debits from posted vendor bills where a line sets aquaculture_pond (and optional cycle / "
        "bucket). Inventory debits on the same bill are not counted in pond operating P&L until consumed. "
        "Avoid re-entering the same purchase as a manual pond expense."
    ),
    "equipment": (
        "For inventoried equipment or supplies sold from your shop to a pond, prefer POS on account to the pond’s "
        "customer. Use this category for durable equipment and tools purchased for the pond (not routine repairs). "
        "Prefer Repair & maintenance for labour and materials to fix structures, pumps, wiring, or vehicles."
    ),
    "repair_maintenance": (
        "Use for pond dike or yard repairs, pump or aerator service, electrical fixes, vehicle/boat engine work, "
        "welding, plumbing, and other upkeep that keeps the site running (GL 6722). Capitalized major purchases may "
        "belong under Equipment or your fixed-asset policy—describe clearly in Memo."
    ),
    "shop_supplies": (
        "Inventoried shop goods issued or sold to a pond (nets, rope, fittings, tools, non-feed supplies). Prefer "
        "vendor bills with pond tag, POS on account, or internal shop stock issue—posts to the shop_supplies cost bucket."
    ),
    "mortality": (
        "Costs tied to fish loss events: disposal, predator fencing, netting after snake or bird damage, and similar "
        "shrinkage-related site costs. Biological book-value write-offs from the fish stock ledger post separately "
        "(Dr 6726 / Cr 1581); use this category for cash expenses linked to mortality management."
    ),
    "other": (
        "Use for feeding boats; electrical wire, fittings, and bulbs; security cameras; engines; aerators; nets; "
        "casual labour; worker meals or site consumables; and other pond operating costs that do not fit a named "
        "category above (prefer Repair & maintenance for paid repair work on dikes, pumps, or vehicles). "
        "Describe the payment clearly in Memo."
    ),
}
# Display-only (pre-split DB rows); not in EXPENSE_CATEGORY_CODES — API rejects on create/update.
EXPENSE_CATEGORY_LABELS["feed_medicine"] = "Feed & medicine purchase (legacy)"

AQUACULTURE_INCOME_TYPE_CHOICES: tuple[tuple[str, str], ...] = (
    ("fish_harvest_sale", "Fish harvest sale"),
    ("fingerling_sale", "Fingerling / fry sale"),
    ("processing_value_add", "Processing / value-added"),
    ("empty_feed_sack_sale", "Empty feed sack sale"),
    ("used_material_sale", "Used / scrap material sale"),
    ("rejected_material_sale", "Rejected material sale"),
    ("used_equipment_sale", "Used / scrap equipment sale"),
    ("biological_count_gain", "Biological inventory count gain"),
    ("other_income", "Other income"),
)

INCOME_TYPE_CODES: frozenset[str] = frozenset(c for c, _ in AQUACULTURE_INCOME_TYPE_CHOICES)
INCOME_TYPE_LABELS: dict[str, str] = {c: label for c, label in AQUACULTURE_INCOME_TYPE_CHOICES}

# Pond revenue that is not fish biomass (do not subtract from implied fish kg/count in stock position).
NON_BIOLOGICAL_POND_SALE_INCOME_TYPES: frozenset[str] = frozenset(
    {
        "empty_feed_sack_sale",
        "used_material_sale",
        "rejected_material_sale",
        "used_equipment_sale",
    }
)

# Harvest line species (polyculture / mixed sales); stable keys in DB. Default tilapia for main culture.
AQUACULTURE_FISH_SPECIES_CHOICES: tuple[tuple[str, str], ...] = (
    ("not_applicable", "N/A (not fish)"),
    ("tilapia", "Tilapia"),
    ("rui", "Rui (rohu)"),
    ("catla", "Catla"),
    ("common_carp", "Common carp"),
    ("silver_carp", "Silver carp"),
    ("bighead_carp", "Bighead carp"),
    ("grass_carp", "Grass carp"),
    ("puti", "Puti"),
    ("kalibaush", "Kalibaush"),
    ("pangas", "Pangas"),
    ("other", "Other"),
)

FISH_SPECIES_CODES: frozenset[str] = frozenset(c for c, _ in AQUACULTURE_FISH_SPECIES_CHOICES)
FISH_SPECIES_LABELS: dict[str, str] = {c: label for c, label in AQUACULTURE_FISH_SPECIES_CHOICES}

# Fish stock ledger: mortality / predation vs manual reconciliation (signed deltas for adjustments).
STOCK_LEDGER_ENTRY_KIND_CHOICES: tuple[tuple[str, str], ...] = (
    ("loss", "Loss (mortality, predation, theft, etc.)"),
    ("adjustment", "Manual count / weight adjustment"),
)

STOCK_LEDGER_ENTRY_KIND_CODES: frozenset[str] = frozenset(c for c, _ in STOCK_LEDGER_ENTRY_KIND_CHOICES)
STOCK_LEDGER_ENTRY_KIND_LABELS: dict[str, str] = {c: label for c, label in STOCK_LEDGER_ENTRY_KIND_CHOICES}

STOCK_LEDGER_LOSS_REASON_CHOICES: tuple[tuple[str, str], ...] = (
    ("mortality", "Mortality (natural / unclassified)"),
    ("disease", "Mortality — disease / treatment loss"),
    ("predator_snake", "Predators — snakes"),
    ("predator_other", "Predators — fish, mammals, or other"),
    ("birds", "Birds"),
    ("theft_escape", "Theft or escape"),
    ("other_loss", "Other loss"),
)

STOCK_LEDGER_LOSS_REASON_CODES: frozenset[str] = frozenset(c for c, _ in STOCK_LEDGER_LOSS_REASON_CHOICES)
STOCK_LEDGER_LOSS_REASON_LABELS: dict[str, str] = {c: label for c, label in STOCK_LEDGER_LOSS_REASON_CHOICES}

STOCK_LEDGER_COA_NOTE = (
    "Optional GL posting uses seeded accounts: 1581 biological inventory (asset), 6726 mortality & shrinkage "
    "(expense), 4244 biological count gain (income). Re-save Company settings or run COA seed if codes are missing."
)

FISH_STOCK_LEDGER_PL_NOTE = (
    "Biological write-offs (management P&L): sum of book value on fish stock ledger rows with entry_kind=loss "
    "in the period. When post_to_books is used, the same amount is also posted as Dr 6726 / Cr 1581."
)

# Accept common aliases from clients (normalized before lookup).
_FISH_SPECIES_ALIASES: dict[str, str] = {
    "ruhi": "rui",
    "rohu": "rui",
    "general_carp": "common_carp",
    "pangasius": "pangas",
    "pangas_catfish": "pangas",
}


def normalize_expense_category(raw: str | None) -> tuple[str | None, str | None]:
    """Returns (code, error_message)."""
    if raw is None:
        return None, "expense_category is required"
    s = str(raw).strip().lower().replace(" ", "_")
    if not s:
        return None, "expense_category is required"
    if len(s) > 64:
        return None, "expense_category must be at most 64 characters"
    if s not in EXPENSE_CATEGORY_CODES:
        return None, f"Unknown expense_category: {raw!r}. Use a known category code."
    if s == "vendor_bill_pond":
        return (
            None,
            "vendor_bill_pond is derived from posted vendor bills with pond-tagged lines; it cannot be entered manually.",
        )
    return s, None


def normalize_income_type(raw: str | None) -> tuple[str, str | None]:
    """Returns (code, error_message). Default fish_harvest_sale when missing."""
    if raw is None or str(raw).strip() == "":
        return "fish_harvest_sale", None
    s = str(raw).strip().lower().replace(" ", "_")
    if len(s) > 64:
        return "fish_harvest_sale", "income_type must be at most 64 characters"
    if s not in INCOME_TYPE_CODES:
        return "fish_harvest_sale", f"Unknown income_type: {raw!r}. Use a known income type code."
    return s, None


def normalize_pond_role(raw: str | None) -> tuple[str, str | None]:
    """Returns (code, error_message). Default grow_out when missing."""
    if raw is None or str(raw).strip() == "":
        return "grow_out", None
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    if len(s) > 32:
        return "grow_out", "pond_role must be at most 32 characters"
    if s not in POND_ROLE_CODES:
        return "grow_out", f"Unknown pond_role: {raw!r}. Use a known role code."
    return s, None


def normalize_fish_species(raw: str | None) -> tuple[str, str | None]:
    """Returns (code, error_message). Default tilapia when missing."""
    if raw is None or str(raw).strip() == "":
        return "tilapia", None
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    s = _FISH_SPECIES_ALIASES.get(s, s)
    if len(s) > 64:
        return "tilapia", "fish_species must be at most 64 characters"
    if s not in FISH_SPECIES_CODES:
        return "tilapia", f"Unknown fish_species: {raw!r}. Use a known species code."
    return s, None


def normalize_fish_species_other(raw: str | None, species_code: str) -> str:
    """When species is not 'other', stored value is cleared."""
    if species_code != "other":
        return ""
    return str(raw or "").strip()[:120]


def normalize_stock_ledger_entry_kind(raw: str | None) -> tuple[str, str | None]:
    """Returns (code, error_message). Default adjustment when missing."""
    if raw is None or str(raw).strip() == "":
        return "adjustment", None
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    if len(s) > 20:
        return "adjustment", "entry_kind must be at most 20 characters"
    if s not in STOCK_LEDGER_ENTRY_KIND_CODES:
        return "adjustment", f"Unknown entry_kind: {raw!r}. Use loss or adjustment."
    return s, None


def normalize_stock_ledger_loss_reason(raw: str | None, entry_kind: str) -> tuple[str, str | None]:
    """Returns (code, error_message). Blank allowed for adjustment; required for loss."""
    if entry_kind != "loss":
        return "", None
    if raw is None or str(raw).strip() == "":
        return "", "loss_reason is required for entry_kind loss"
    s = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    if len(s) > 32:
        return "", "loss_reason must be at most 32 characters"
    if s not in STOCK_LEDGER_LOSS_REASON_CODES:
        return "", f"Unknown loss_reason: {raw!r}."
    return s, None


def fish_species_display_label(code: str | None, other: str | None) -> str:
    c = (code or "tilapia").strip() or "tilapia"
    base = FISH_SPECIES_LABELS.get(c, c)
    o = (other or "").strip()
    if c == "other" and o:
        return f"{base}: {o}"
    return base


def coa_account_code_for_aquaculture_expense_category(
    expense_category: str, company_id: int | None = None
) -> str:
    """
    Chart account code for vendor bill expense debits when a line tags an aquaculture pond
    (see aquaculture_coa_seed AQUACULTURE_COA_ROWS 6711–6725).
    """
    c = (expense_category or "other").strip()
    if company_id is not None:
        from api.services.tenant_reporting_categories import resolve_aquaculture_expense_to_builtin

        c = resolve_aquaculture_expense_to_builtin(company_id, c)
    mapping: dict[str, str] = {
        "lease": "6711",
        "worker_salary": "6712",
        "soilcut": "6713",
        "pond_preparation": "6714",
        "fry_stocking": "6715",
        "feed_purchase": "6716",
        "feed_consumed": "6716",
        "feed_medicine": "6716",
        "electricity": "6717",
        "equipment": "6718",
        "repair_maintenance": "6722",
        "shop_supplies": "6725",
        "mortality": "6726",
        "fisherman": "6719",
        "transportation": "6720",
        "medicine_purchase": "6721",
        "medicine_consumed": "6721",
        "other": "6725",
        "vendor_bill_pond": "6725",
    }
    return mapping.get(c, "6725")


def coa_account_code_for_aquaculture_income_type(income_type: str, company_id: int | None = None) -> str:
    """
    Chart account code for invoice GL revenue when a pond sale is linked to an Invoice
    (see aquaculture_coa_seed AQUACULTURE_COA_ROWS 4240–4244).
    """
    it = (income_type or "fish_harvest_sale").strip()
    if company_id is not None:
        from api.services.tenant_reporting_categories import resolve_aquaculture_income_to_builtin

        it = resolve_aquaculture_income_to_builtin(company_id, it)
    if it == "fish_harvest_sale":
        return "4240"
    if it == "fingerling_sale":
        return "4241"
    if it == "processing_value_add":
        return "4242"
    if it in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES:
        return "4244"
    if it == "biological_count_gain":
        return "4244"
    return "4243"
