"""Aquaculture expense category codes, income line types, and shared-cost rule (API + UI)."""

from __future__ import annotations

# Inter-pond fish transfers (nursing → grow-out): documented on P&L API and transfers UI.
INTER_POND_FISH_TRANSFER_PL_NOTE = (
    "Inter-pond fish transfers: each line can carry cost_amount (same currency as expenses). "
    "Pond P&L treats this as moving biological cost — operating expenses increase on receiving ponds and "
    "decrease on the source pond by the same totals, so company-wide direct costs are unchanged. "
    "Enter weight_kg (and optional fish_count / pcs_per_kg) for production tracking; allocate cost_amount "
    "from the nursing pond’s fry and nursing-period costs (for example proportional to kg or your auditor’s rule)."
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
    ("medicine_purchase", "Medicine purchase"),
    ("electricity", "Electricity"),
    ("equipment", "Equipment (aerators, nets, etc.)"),
    ("fisherman", "Fisherman bills"),
    ("transportation", "Transportation"),
    ("other", "Miscellaneous"),
)

EXPENSE_CATEGORY_CODES: frozenset[str] = frozenset(c for c, _ in AQUACULTURE_EXPENSE_CATEGORY_CHOICES)

EXPENSE_CATEGORY_LABELS: dict[str, str] = {c: label for c, label in AQUACULTURE_EXPENSE_CATEGORY_CHOICES}

# Optional longer copy for UIs (expense-categories API includes hint when present).
EXPENSE_CATEGORY_EXTRA_HELP: dict[str, str] = {
    "feed_purchase": (
        "Recommended: sell inventoried feed from Cashier (POS) to the pond’s linked customer on account—quantities, "
        "inventory, revenue, and AR follow your normal POS posting. Link each pond to a customer under Ponds. Use "
        "“Add expense” here for cash/off-site feed (no POS draw) or allocations; add sacks/kg when helpful. Optional "
        "“internal stock issue” on the expenses page is only for at-cost transfers without a POS sale—never use both "
        "for the same goods."
    ),
    "medicine_purchase": (
        "Same pattern as feed: prefer POS sale on account to the pond’s customer for stocked medicine so quantity and "
        "GL stay correct. Use this expense line for cash purchases or vendor bills not rung through POS."
    ),
    "equipment": (
        "For inventoried equipment or supplies sold from your shop to a pond, prefer POS on account to the pond’s "
        "customer. Use this category for direct cash capex or hire/repair that is not a POS inventory sale."
    ),
    "other": (
        "Use for feeding boats; electrical wire, fittings, and bulbs; security cameras; engines; aerators; nets; "
        "road, yard, or dike repairs; bicycles (purchase or repair); casual labour; worker meals or site consumables; "
        "and other pond operating costs that do not fit a named category above. Describe the payment clearly in Memo."
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


def coa_account_code_for_aquaculture_income_type(income_type: str) -> str:
    """
    Chart account code for invoice GL revenue when a pond sale is linked to an Invoice
    (see aquaculture_coa_seed AQUACULTURE_COA_ROWS 4240–4244).
    """
    it = (income_type or "fish_harvest_sale").strip()
    if it == "fish_harvest_sale":
        return "4240"
    if it == "fingerling_sale":
        return "4241"
    if it == "processing_value_add":
        return "4242"
    if it in NON_BIOLOGICAL_POND_SALE_INCOME_TYPES:
        return "4244"
    return "4243"
