"""
Automatic GL posting for invoices, POS sales, payments, bills, and fund transfers.

Uses fuel-station template account codes when present. For payment/receipt paths,
missing accounts raise GlPostingError so the operation rolls back and the subledger
stays consistent with the general ledger.

Journal lines optionally carry ``station_id`` (5th tuple element in internal line lists)
so multi-site tenants can run site-scoped trial balance and income statement.
"""
from __future__ import annotations

import logging
import uuid
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Optional

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from api.models import (
    AquacultureExpense,
    AquacultureExpenseInventoryLine,
    AquacultureFishSale,
    AquacultureFishStockLedger,
    AquacultureLandlordLedgerEntry,
    AquaculturePond,
    AquacultureProductionCycle,
    BankAccount,
    Bill,
    BillLine,
    ChartOfAccount,
    Customer,
    EmployeeLedgerEntry,
    FundTransfer,
    InventoryAdjustment,
    InventoryAdjustmentLine,
    InventoryTransfer,
    InventoryTransferLine,
    Invoice,
    InvoiceLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    Meter,
    Payment,
    PaymentInvoiceAllocation,
    PayrollRun,
    PayrollRunPondAllocation,
    Station,
    Tank,
    TankDip,
    Vendor,
)
from api.exceptions import GlPostingError, StockBusinessError
from api.services.entity_gl_scoping import (
    validate_bill_entity_tags_for_gl,
    validate_invoice_entity_tags_for_gl,
    validate_payroll_entity_tags_for_gl,
)
from api.services.aquaculture_constants import (
    coa_account_code_for_aquaculture_expense_category,
    coa_account_code_for_aquaculture_income_type,
)
from api.services.aquaculture_cost_per_kg import (
    aquaculture_expense_category_to_cost_bucket,
    item_shop_issue_cost_bucket,
)
from api.services.item_catalog import (
    TYPE_NON_INVENTORY,
    item_tracks_physical_stock,
    normalize_item_type,
)
from api.services.shift_sales import unrecord_invoice_from_shift
from api.services.station_stock import add_station_stock, item_uses_station_bins
from api.utils.customer_display import customer_display_name
from api.services.coa_constants import is_pl_credit_normal_type, normalize_chart_account_type
from api.services.erp_coa_defaults import ErpCoaCode
from api.services.employee_payroll_subledger import (
    refresh_employee_balance,
    sync_payroll_run_to_employee_ledgers,
)

logger = logging.getLogger(__name__)


def _default_open_cycle_id_for_pond(company_id: int, pond_id: int) -> int | None:
    """Single active open cycle for a pond, else None (avoids guessing when several are open)."""
    rows = list(
        AquacultureProductionCycle.objects.filter(
            company_id=company_id,
            pond_id=pond_id,
            is_active=True,
            end_date__isnull=True,
        ).order_by("-start_date", "-id")[:2]
    )
    if len(rows) == 1:
        return int(rows[0].id)
    return None


def _invoice_aquaculture_pond_cycle(company_id: int, inv: Invoice) -> tuple[int | None, int | None]:
    """
    Pond (and optional cycle) for invoice GL tagging: linked fish sale, else customer = pond POS customer.
    """
    aq_sale = (
        AquacultureFishSale.objects.filter(invoice_id=inv.id, company_id=company_id)
        .only("pond_id", "production_cycle_id")
        .first()
    )
    if aq_sale and aq_sale.pond_id:
        pid = int(aq_sale.pond_id)
        cid = int(aq_sale.production_cycle_id) if aq_sale.production_cycle_id else None
        return pid, cid
    if inv.customer_id:
        pond = (
            AquaculturePond.objects.filter(
                company_id=company_id, pos_customer_id=inv.customer_id, is_active=True
            )
            .only("id")
            .first()
        )
        if pond:
            pid = int(pond.id)
            return pid, _default_open_cycle_id_for_pond(company_id, pid)
    return None, None


def _aquaculture_revenue_cost_bucket(income_type: str) -> str:
    """Journal line bucket for aquaculture-linked invoice revenue (distinct from operating cost buckets)."""
    it = (income_type or "fish_harvest_sale").strip().replace(" ", "_").lower()[:28]
    s = f"rev_{it}"
    return s[:40]


def _journal_line_aquaculture_kwargs(company_id: int, meta: dict | None) -> dict[str, Any]:
    """Validated optional FK + bucket for aquaculture costing on journal lines."""
    if not meta:
        return {}
    out: dict[str, Any] = {}
    pid = meta.get("pond_id")
    if pid is not None:
        try:
            pid_i = int(pid)
        except (TypeError, ValueError):
            pid_i = 0
        if pid_i > 0 and AquaculturePond.objects.filter(pk=pid_i, company_id=company_id).exists():
            out["aquaculture_pond_id"] = pid_i
    cid = meta.get("production_cycle_id")
    if cid is not None and cid != "":
        try:
            cid_i = int(cid)
        except (TypeError, ValueError):
            cid_i = 0
        if cid_i > 0 and AquacultureProductionCycle.objects.filter(pk=cid_i, company_id=company_id).exists():
            out["aquaculture_production_cycle_id"] = cid_i
    bucket = str(meta.get("cost_bucket") or "").strip()[:40]
    if bucket:
        out["aquaculture_cost_bucket"] = bucket
    return out


def _journal_line_fuel_station_kwargs(company_id: int, meta: dict | None) -> dict[str, Any]:
    """Optional fuel-station reporting tag on journal lines (from vendor bills or manual entry)."""
    if not meta:
        return {}
    from api.services.tenant_reporting_categories import (
        FUEL_STATION_EXPENSE_MAP_CODES,
        fuel_station_reporting_category_for_journal,
    )

    out: dict[str, Any] = {}
    trc_id = meta.get("tenant_reporting_category_id")
    if trc_id is not None:
        try:
            tid = int(trc_id)
        except (TypeError, ValueError):
            tid = 0
        if tid > 0 and fuel_station_reporting_category_for_journal(company_id, tid):
            out["tenant_reporting_category_id"] = tid
    rollup = str(meta.get("fuel_station_expense_rollup") or "").strip()
    if rollup and rollup in FUEL_STATION_EXPENSE_MAP_CODES:
        out["fuel_station_expense_rollup"] = rollup[:64]
    return out


def _journal_line_bill_meta_kwargs(company_id: int, meta: dict | None) -> dict[str, Any]:
    if not meta:
        return {}
    return {**_journal_line_aquaculture_kwargs(company_id, meta), **_journal_line_fuel_station_kwargs(company_id, meta)}


def _unpack_gl_line(
    line: tuple,
) -> tuple[ChartOfAccount, Decimal, Decimal, str, Optional[int], bool]:
    """
    Parse internal GL line tuple.

    - 4-tuple: station not set on tuple; caller's ``gl_station_id`` applies to the line.
    - 5-tuple: explicit per-line site (``None`` = leave line untagged when header is also null).
    """
    acc, debit, credit, desc = line[0], line[1], line[2], line[3]
    if len(line) >= 5:
        s = line[4]
        sid = int(s) if s is not None else None
        return acc, debit, credit, desc, sid, True
    return acc, debit, credit, desc, None, False


def _gl_invoice_customer_label(inv: Invoice) -> str:
    return customer_display_name(getattr(inv, "customer", None))


def _gl_invoice_line_memo(inv: Invoice, prefix: str = "") -> str:
    """Line memo on auto-posted invoice journals (max 300 chars)."""
    inv_ref = (inv.invoice_number or f"INV-{inv.id}").strip()
    cust = _gl_invoice_customer_label(inv)
    core = f"{inv_ref} — {cust}" if cust else inv_ref
    s = f"{prefix.strip()} {core}".strip() if prefix else core
    return s[:300]


def _gl_invoice_journal_description(inv: Invoice, title: str) -> str:
    """JournalEntry.description for invoice-related auto entries (max 500)."""
    inv_ref = inv.invoice_number or f"INV-{inv.id}"
    cust = _gl_invoice_customer_label(inv)
    if cust:
        return f"{title} {inv_ref} — {cust}"[:500]
    return f"{title} {inv_ref}"[:500]


def _gl_station_id(company_id: int, raw: int | None) -> Optional[int]:
    """Active station for this company, or None if unset / invalid / inactive."""
    if raw is None:
        return None
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    if Station.objects.filter(pk=sid, company_id=company_id, is_active=True).exists():
        return sid
    return None


# Default codes aligned with api.chart_templates.fuel_station
CODE_CASH = "1010"
CODE_UNDEPOSITED = "1020"
CODE_BANK_OP = "1030"
CODE_AR = "1100"
CODE_CARD_CLEARING = "1120"
CODE_AP = "2000"
CODE_VAT = "2100"
CODE_FUEL_REV = "4100"
CODE_SHOP_REV = "4200"
CODE_OTHER_REV = "4230"
CODE_OFFICE_EXP = "6900"
CODE_DONATION_SOCIAL = "6910"
CODE_COGS_FUEL = "5100"
CODE_COGS_SHOP = "5120"
CODE_SHRINK_FUEL = "5200"
CODE_SHRINK_SHOP = "5210"
CODE_INV_FUEL = "1200"
CODE_INV_SHOP = "1220"
# Aquaculture biological inventory (live fish in ponds) — seeded for aquaculture companies (1581).
CODE_INV_BIO = "1581"
# Aquaculture lease / pond rental (see aquaculture_coa_seed 6711)
CODE_AQ_LEASE_EXPENSE = "6711"
# Payroll (fuel_station template; optional — posting skips if 6400 missing)
CODE_SALARY_EXP = "6400"
CODE_AQUACULTURE_LABOR_EXP = "6712"
CODE_SALARY_PAYABLE = "2200"
CODE_STAT_DED = "2210"


def _coa(company_id: int, code: str) -> Optional[ChartOfAccount]:
    return (
        ChartOfAccount.objects.filter(
            company_id=company_id, account_code=code, is_active=True
        )
        .first()
    )


# Standard COGS/inventory accounts auto-provisioned so a sale can ALWAYS post a balanced COGS
# journal (double-entry needs both a COGS and an inventory account). Matches the fuel-station
# template definitions. (code -> name, account_type, account_sub_type).
_STANDARD_GL_ACCOUNTS: dict[str, tuple[str, str, str]] = {
    CODE_COGS_FUEL: ("Cost of Fuel Sold", "cost_of_goods_sold", "cost_of_goods_sold"),
    CODE_COGS_SHOP: ("Cost of C-Store Goods Sold", "cost_of_goods_sold", "cost_of_goods_sold"),
    CODE_INV_FUEL: ("Inventory — Fuel (Wet Stock at Cost)", "asset", "inventory"),
    CODE_INV_SHOP: ("Inventory — C-Store / Shop", "asset", "inventory"),
}


def _ensure_standard_account(company_id: int, code: str) -> Optional[ChartOfAccount]:
    """
    Return the active standard account for ``code``, creating it from the template if missing.
    Used only for the COGS-relief fallback accounts so COGS is never skipped for lack of a GL
    account. Re-activates a soft-disabled standard account rather than leaving COGS unposted.
    """
    acc = _coa(company_id, code)
    if acc:
        return acc
    spec = _STANDARD_GL_ACCOUNTS.get(code)
    if not spec:
        return None
    name, acc_type, sub_type = spec
    existing = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=code
    ).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            existing.save(update_fields=["is_active", "updated_at"])
        return existing
    return ChartOfAccount.objects.create(
        company_id=company_id,
        account_code=code,
        account_name=name,
        account_type=acc_type,
        account_sub_type=sub_type,
        description="",
        parent_id=None,
        opening_balance=Decimal("0"),
        opening_balance_date=timezone.now().date(),
        is_active=True,
    )


def _is_walkin_customer(customer: Optional[Customer]) -> bool:
    if not customer:
        return True
    name = (customer.display_name or "").strip().lower()
    return name == "walk-in"


def _debit_account_for_paid_sale(
    company_id: int,
    payment_method: str,
    bank_account_id: Optional[int],
    *,
    prefer_undeposited_clearing: bool = False,
) -> Optional[ChartOfAccount]:
    pm = (payment_method or "cash").strip().lower()
    if pm in ("card", "credit_card", "debit_card"):
        a = _coa(company_id, CODE_CARD_CLEARING)
        if a:
            return a
    if bank_account_id:
        bank = (
            BankAccount.objects.filter(id=bank_account_id, company_id=company_id)
            .select_related("chart_account")
            .first()
        )
        if bank and bank.chart_account_id:
            return bank.chart_account
    if pm in ("bank", "transfer", "wire"):
        a = _coa(company_id, CODE_BANK_OP)
        if a:
            return a
    # POS / cash invoice sales: till cash (1010) first when both exist.
    # Payments received without a bank register: prefer 1020 undeposited when both exist (deposit workflow).
    if prefer_undeposited_clearing:
        undep = _coa(company_id, CODE_UNDEPOSITED)
        cash = _coa(company_id, CODE_CASH)
        if undep and cash:
            return undep
        return undep or cash
    return _coa(company_id, CODE_CASH) or _coa(company_id, CODE_UNDEPOSITED)


def post_pos_cash_donation_journal(
    company_id: int,
    *,
    amount: Decimal,
    entry_date,
    memo: str,
    bank_account_id: Optional[int],
    gl_station_id: Optional[int] = None,
) -> tuple[Optional[JournalEntry], str]:
    """
    Record cash (or register-linked) payout for donation / social support from POS.
    Dr Donation & Social Support (6910), Cr same cash/clearing GL as POS uses for cash (1010 by default).
    """
    if amount is None or amount <= 0:
        return None, "Amount must be positive"
    exp = _coa(company_id, CODE_DONATION_SOCIAL)
    if not exp:
        return None, "Chart account 6910 Donation & Social Support is missing. Sync the chart of accounts or run master push for COA defaults."
    cash = _debit_account_for_paid_sale(company_id, "cash", bank_account_id)
    if not cash:
        return None, "No cash-on-hand (1010) or register-linked GL. Add account 1010 or link a register to a chart line."
    line_memo = (memo or "POS — donation & social support")[:300]
    entry_num = f"AUTO-POS-DON-{uuid.uuid4().hex[:12].upper()}"
    desc = f"Donation & social support — {line_memo}"[:500]
    lines = [
        (exp, amount, Decimal("0"), line_memo),
        (cash, Decimal("0"), amount, line_memo),
    ]
    je = _create_posted_entry(
        company_id,
        entry_date,
        entry_num,
        desc,
        lines,
        gl_station_id=_gl_station_id(company_id, gl_station_id),
    )
    if not je:
        return None, "Could not post journal. Please try again."
    return je, ""


def _is_fuel_item(item) -> bool:
    if not item:
        return False
    unit = (item.unit or "").lower()
    pos_cat = (item.pos_category or "").lower()
    cat = (item.category or "").lower()
    name = (getattr(item, "name", None) or "").lower()
    if unit in ("l", "liter", "litre", "gal", "gallon") or "fuel" in pos_cat or "fuel" in cat:
        return True
    # Items often default to unit "piece" / category empty — treat common wet-stock names as fuel
    fuel_name_tokens = (
        "diesel",
        "petrol",
        "gasoline",
        "gasohol",
        "octane",
        "premium",
        "mogas",
        "kerosene",
        "e85",
        "biodiesel",
        "lpg",
        "cng",
    )
    return any(tok in name for tok in fuel_name_tokens)


def _is_fish_item(item) -> bool:
    """Fish fry/fingerling SKU — live biomass tracked per pond (pos_category == 'fish')."""
    return (getattr(item, "pos_category", None) or "").strip().lower() == "fish"


def _inventory_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    if item is not None and getattr(item, "inventory_account_id", None):
        acc = ChartOfAccount.objects.filter(
            pk=item.inventory_account_id, company_id=company_id, is_active=True
        ).first()
        if acc:
            nt = normalize_chart_account_type(acc.account_type)
            if nt in ("asset", "bank_account"):
                return acc
    # Live fish capitalize into Biological Inventory (1581) so each pond's balance sheet shows the
    # bio-asset cleanly; relieved on sale/mortality through the same account. Fall back to shop
    # inventory only when 1581 is not seeded (non-aquaculture companies have no fish items).
    if _is_fish_item(item):
        bio = _coa(company_id, CODE_INV_BIO)
        if bio:
            return bio
    if _is_fuel_item(item):
        return _ensure_standard_account(company_id, CODE_INV_FUEL)
    return _ensure_standard_account(company_id, CODE_INV_SHOP) or _ensure_standard_account(
        company_id, CODE_INV_FUEL
    )


def _cogs_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    from api.services.coa_constants import pl_bucket_for_coa

    if item is not None and getattr(item, "cogs_account_id", None):
        acc = ChartOfAccount.objects.filter(
            pk=item.cogs_account_id, company_id=company_id, is_active=True
        ).first()
        if acc and pl_bucket_for_coa(acc.account_type, acc.account_sub_type, acc.account_code) == "cost_of_goods_sold":
            return acc
    if _is_fuel_item(item):
        return _ensure_standard_account(company_id, CODE_COGS_FUEL)
    return _ensure_standard_account(company_id, CODE_COGS_SHOP) or _ensure_standard_account(
        company_id, CODE_COGS_FUEL
    )


def item_inventory_unit_cost(item: Optional[Item]) -> Decimal:
    """
    Per-unit cost for inventory / wet-stock GL (liters, pieces, etc.).
    Prefer Item.cost; if unset, fall back to unit_price so reports and dip GL are not all zero.

    NOTE: Do NOT use this for COGS-relief journals (Dr COGS / Cr inventory) — use
    item_cogs_unit_cost, which guarantees a COGS amount via the best-available cost.
    """
    if not item:
        return Decimal("0")
    c = item.cost or Decimal("0")
    if c > 0:
        return c
    return item.unit_price or Decimal("0")


def item_inventory_cost_strict(item: Optional[Item]) -> Decimal:
    """
    AVCO cost only (Item.cost), no fallback. Kept for callers that specifically need the
    moving-average value with no estimation. COGS relief uses ``item_cogs_unit_cost`` so a
    sale always posts a COGS amount.
    """
    if not item:
        return Decimal("0")
    c = item.cost or Decimal("0")
    return c if c > 0 else Decimal("0")


def item_cogs_unit_cost(company_id: int, item: Optional[Item]) -> Decimal:
    """
    Best-available per-unit cost for COGS relief so that EVERY sale of a stock-tracked item
    posts a COGS amount (Dr COGS / Cr inventory) — never silently zero.

    Standard perpetual-inventory fallback, most → least reliable:
      1. Moving-average cost (Item.cost)        — normal AVCO valuation
      2. Most recent posted purchase unit price — last actual buy price
      3. Opening stock unit cost                — initial valuation
      4. Selling price (unit_price)             — last-resort guarantee (zero-margin sale)

    Returns 0 only when the item is missing or has no cost, no purchase history, and no price.
    """
    if not item:
        return Decimal("0")
    c = item.cost or Decimal("0")
    if c > 0:
        return c
    last_purchase = (
        BillLine.objects.filter(
            bill__company_id=company_id,
            bill__stock_receipt_applied=True,
            item_id=item.id,
            quantity__gt=0,
            unit_price__gt=0,
        )
        .order_by("-bill__bill_date", "-id")
        .values_list("unit_price", flat=True)
        .first()
    )
    if last_purchase and last_purchase > 0:
        return last_purchase
    opening = item.opening_stock_unit_cost or Decimal("0")
    if opening > 0:
        return opening
    return item.unit_price or Decimal("0")


def item_has_cost_basis(company_id: int, item: Optional[Item]) -> bool:
    """
    True when the item has a real cost (AVCO, posted purchase, or opening cost) — the
    selling-price last resort does NOT count. Used to relieve COGS for sold items that
    are not flagged as physical-stock but still carry a known cost, so the P&L shows COGS.
    """
    if not item:
        return False
    if (item.cost or Decimal("0")) > 0:
        return True
    if (item.opening_stock_unit_cost or Decimal("0")) > 0:
        return True
    return BillLine.objects.filter(
        bill__company_id=company_id,
        bill__stock_receipt_applied=True,
        item_id=item.id,
        quantity__gt=0,
        unit_price__gt=0,
    ).exists()


def item_should_relieve_cogs(company_id: int, item: Optional[Item]) -> bool:
    """
    Whether a sold line should post COGS: any physical-stock item, or any item that
    carries a real cost basis even if it is not stock-tracked.

    Gap closure: explicit non-inventory *goods* (item_type="non_inventory") also relieve
    COGS whenever a unit cost can be determined (incl. the selling-price last resort in
    ``item_cogs_unit_cost``), so the P&L never shows non-inventory goods sold without a
    matching Cost of Goods Sold. Services (item_type="service") carry no COGS.
    """
    if not item:
        return False
    if item_tracks_physical_stock(item) or item_has_cost_basis(company_id, item):
        return True
    if normalize_item_type(getattr(item, "item_type", None)) == TYPE_NON_INVENTORY:
        return item_cogs_unit_cost(company_id, item) > 0
    return False


def apply_weighted_average_cost_on_receipt(
    company_id: int, item_id: int, received_qty: Decimal, received_value: Decimal
) -> None:
    """
    Update Item.cost to the moving weighted average (AVCO) when stock is received on a vendor bill.

        new_cost = (on_hand_before * old_cost + received_value) / (on_hand_before + received_qty)

    AVCO is accepted under IFRS (IAS 2) and US GAAP and is the most widely used perpetual method.
    Only receipts move the unit cost — issues/sales at average cost leave it unchanged. Must be
    called BEFORE the receipt increments quantity_on_hand. Fish/biological SKUs are skipped (those
    are valued via aquaculture cost-per-kg).
    """
    if received_qty is None or received_value is None or received_qty <= 0 or received_value <= 0:
        return
    it = (
        Item.objects.filter(pk=item_id, company_id=company_id)
        .only("id", "cost", "quantity_on_hand", "pos_category", "item_type", "unit", "category", "name")
        .first()
    )
    if not it or not item_tracks_physical_stock(it):
        return
    if (it.pos_category or "").strip().lower() == "fish":
        return
    old_qty = it.quantity_on_hand or Decimal("0")
    old_cost = it.cost or Decimal("0")
    denom = old_qty + received_qty
    if old_qty <= 0 or old_cost <= 0 or denom <= 0:
        new_cost = received_value / received_qty
    else:
        new_cost = (old_qty * old_cost + received_value) / denom
    new_cost = new_cost.quantize(Decimal("0.0001"))
    if new_cost != (it.cost or Decimal("0")):
        Item.objects.filter(pk=item_id, company_id=company_id).update(cost=new_cost)


def recompute_item_average_cost(company_id: int, item_id: int) -> Optional[Decimal]:
    """
    Deterministically rebuild Item.cost as AVCO from the opening layer + all posted bill receipts:

        cost = (opening_qty * opening_unit_cost + sum(receipt amount)) / (opening_qty + sum(receipt qty))

    Unlike the incremental ``apply_weighted_average_cost_on_receipt`` (which blends one receipt onto the
    current cost), this is a pure function of the receipt history, so it is idempotent: editing and
    re-saving the same bill cannot drift the unit cost. Reversing a receipt only restores quantity, not
    the blended cost, so this must be called after a reverse+repost cycle to keep the average correct.

    Returns the recomputed cost when set, otherwise None (e.g. fish/biological or no costed stock).
    """
    item = (
        Item.objects.filter(pk=item_id, company_id=company_id)
        .only(
            "id",
            "cost",
            "opening_stock_quantity",
            "opening_stock_unit_cost",
            "pos_category",
            "item_type",
            "unit",
            "category",
            "name",
        )
        .first()
    )
    if not item or not item_tracks_physical_stock(item):
        return None
    if (item.pos_category or "").strip().lower() == "fish":
        return None

    opening_qty = item.opening_stock_quantity or Decimal("0")
    opening_cost = item.opening_stock_unit_cost or Decimal("0")
    base_qty = opening_qty if opening_qty > 0 and opening_cost > 0 else Decimal("0")
    base_value = (opening_qty * opening_cost) if base_qty > 0 else Decimal("0")

    agg = BillLine.objects.filter(
        bill__company_id=company_id,
        bill__stock_receipt_applied=True,
        item_id=item.id,
    ).aggregate(q=Sum("quantity"), v=Sum("amount"))
    recv_qty = agg["q"] or Decimal("0")
    recv_value = agg["v"] or Decimal("0")

    denom = base_qty + recv_qty
    total_value = base_value + recv_value
    if denom <= 0 or total_value <= 0:
        return None

    new_cost = (total_value / denom).quantize(Decimal("0.0001"))
    if new_cost != (item.cost or Decimal("0")):
        Item.objects.filter(pk=item.id, company_id=company_id).update(cost=new_cost)
    return new_cost


def delete_tank_dip_variance_journal(company_id: int, dip_id: int) -> int:
    """Remove AUTO-TANKDIP-{id}-VAR if present (e.g. before delete or re-post)."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-TANKDIP-{dip_id}-VAR",
    ).delete()
    return deleted


def _wet_stock_variance_accounts(
    company_id: int,
) -> tuple[Optional[ChartOfAccount], Optional[ChartOfAccount], Optional[ChartOfAccount]]:
    """
    GL buckets for underground / tank wet stock (all tank dips use these).

    Fuel in tanks is inventory (asset 1200) at cost whether or not the Item row
    is tagged as "fuel" in POS metadata (diesel/petrol SKUs often stay unit=piece).
    """
    inv_acc = _coa(company_id, CODE_INV_FUEL)
    cogs_acc = _coa(company_id, CODE_COGS_FUEL)
    shrink_acc = _coa(company_id, CODE_SHRINK_FUEL) or cogs_acc
    return inv_acc, cogs_acc, shrink_acc


def _tank_dip_variance_journal_skip_reason(company_id: int, dip: TankDip) -> Optional[str]:
    """Why variance GL would not be created (no writes). None = would post."""
    if dip.book_stock_before is None:
        return "no_book_snapshot"
    book = dip.book_stock_before or Decimal("0")
    measured = dip.volume or Decimal("0")
    var_liters = measured - book
    if var_liters == 0:
        return "no_variance"
    prod = dip.tank.product if dip.tank_id else None
    rate = item_inventory_unit_cost(prod)
    if rate <= 0:
        return "item_cost_and_price_zero"
    amount = (abs(var_liters) * rate).quantize(Decimal("0.01"))
    if amount <= 0:
        return "rounded_zero"
    inv_acc, cogs_acc, _ = _wet_stock_variance_accounts(company_id)
    if not inv_acc or not cogs_acc:
        return "missing_inventory_or_cogs_account"
    return None


def tank_dip_variance_gl_status(company_id: int, dip: TankDip) -> dict:
    """For API: posted journal vs skip reason (read-only)."""
    en = f"AUTO-TANKDIP-{dip.id}-VAR"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        return {"posted": True, "entry_number": en, "skip_reason": None}
    return {
        "posted": False,
        "entry_number": None,
        "skip_reason": _tank_dip_variance_journal_skip_reason(company_id, dip),
    }


def sync_tank_dip_variance_journal(company_id: int, dip_id: int) -> dict:
    """
    Align GL inventory $ with physical dip vs book-at-dip, at inventory unit cost.

    - Gain (stick > book): Dr Fuel inventory, Cr COGS — reduces COGS expense (pick-up / count gain).
    - Loss (stick < book): Dr Shrinkage (5200) or COGS, Cr Fuel inventory — wet loss expense.

    Always uses wet-stock fuel accounts (1200 / 5100 / 5200) so diesel, petrol, octane, etc.
    post consistently regardless of Item.unit / pos_category.

    Idempotent per dip: replaces AUTO-TANKDIP-{id}-VAR. Skips if book snapshot missing, zero variance,
    zero cost rate, or required COA missing.
    """
    dip = (
        TankDip.objects.filter(id=dip_id, company_id=company_id)
        .select_related("tank", "tank__product")
        .first()
    )
    if not dip:
        return {"status": "skipped", "reason": "dip_not_found"}
    delete_tank_dip_variance_journal(company_id, dip_id)

    skip = _tank_dip_variance_journal_skip_reason(company_id, dip)
    if skip:
        return {"status": "skipped", "reason": skip}

    book = dip.book_stock_before or Decimal("0")
    measured = dip.volume or Decimal("0")
    var_liters = measured - book
    prod = dip.tank.product if dip.tank_id else None
    rate = item_inventory_unit_cost(prod)
    amount = (abs(var_liters) * rate).quantize(Decimal("0.01"))

    inv_acc, cogs_acc, shrink_acc = _wet_stock_variance_accounts(company_id)
    if not inv_acc or not cogs_acc:
        return {"status": "skipped", "reason": "missing_inventory_or_cogs_account"}

    tank_name = (dip.tank.tank_name or f"Tank {dip.tank_id}")[:80]
    memo_base = f"Dip #{dip.id} {tank_name} — physical vs book ({format(var_liters, 'f')} L @ cost)"
    desc = f"Tank dip variance {tank_name} ({dip.dip_date})"[:500]
    entry_number = f"AUTO-TANKDIP-{dip_id}-VAR"

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    if var_liters > 0:
        # Count gain: increase inventory asset, credit COGS (lowers expense vs sales)
        lines.append((inv_acc, amount, Decimal("0"), memo_base[:300]))
        lines.append((cogs_acc, Decimal("0"), amount, memo_base[:300]))
    else:
        # Loss: shrinkage expense, reduce inventory
        loss_acc = shrink_acc or cogs_acc
        lines.append((loss_acc, amount, Decimal("0"), memo_base[:300]))
        lines.append((inv_acc, Decimal("0"), amount, memo_base[:300]))

    dip_sid = dip.tank.station_id if dip.tank_id else None
    je = _create_posted_entry(
        company_id,
        dip.dip_date,
        entry_number,
        desc,
        lines,
        gl_station_id=_gl_station_id(company_id, dip_sid),
    )
    if je:
        return {"status": "posted", "entry_number": entry_number, "amount": float(amount)}
    return {"status": "skipped", "reason": "journal_create_failed"}


def bulk_sync_tank_dip_variance_journals(company_id: int) -> dict[str, Any]:
    """
    Re-run ``sync_tank_dip_variance_journal`` for every dip in the company (by dip_date, id).

    Use after changing Item unit, **cost**, or **unit_price** so ``AUTO-TANKDIP-{id}-VAR`` amounts
    match current valuation. Fuel inventory (1200) is moved by these entries (gain/loss vs COGS
    or shrinkage); skipped dips keep their prior state (e.g. no variance, no cost).
    """
    reason_counts: Counter[str] = Counter()
    posted = 0
    dip_ids = list(
        TankDip.objects.filter(company_id=company_id)
        .order_by("dip_date", "id")
        .values_list("id", flat=True)
    )
    for did in dip_ids:
        r = sync_tank_dip_variance_journal(company_id, did)
        if r.get("status") == "posted":
            posted += 1
        else:
            reason_counts[str(r.get("reason", "unknown"))] += 1
    return {
        "company_id": company_id,
        "dips_processed": len(dip_ids),
        "posted": posted,
        "skipped": len(dip_ids) - posted,
        "skipped_by_reason": dict(reason_counts),
    }


def _revenue_account_for_item(company_id: int, item) -> Optional[ChartOfAccount]:
    if item is not None and getattr(item, "revenue_account_id", None):
        acc = ChartOfAccount.objects.filter(
            pk=item.revenue_account_id, company_id=company_id, is_active=True
        ).first()
        if acc and is_pl_credit_normal_type(acc.account_type):
            return acc
    if item:
        pos_cat = (item.pos_category or "").lower()
        if _is_fuel_item(item):
            return _coa(company_id, CODE_FUEL_REV) or _coa(company_id, CODE_OTHER_REV)
        if pos_cat in ("shop", "c-store", "convenience", "general", "feed"):
            return _coa(company_id, CODE_SHOP_REV) or _coa(company_id, CODE_OTHER_REV)
    return _coa(company_id, CODE_SHOP_REV) or _coa(company_id, CODE_OTHER_REV) or _coa(
        company_id, CODE_FUEL_REV
    )


def _build_revenue_splits(company_id: int, inv: Invoice) -> dict[int, Decimal]:
    amounts: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    aq_sale = AquacultureFishSale.objects.filter(invoice_id=inv.id).only("income_type").first()
    if aq_sale is not None:
        code = coa_account_code_for_aquaculture_income_type(aq_sale.income_type, company_id=company_id)
        acc = _coa(company_id, code)
        sub = inv.subtotal or Decimal("0")
        if acc and sub > 0:
            return {acc.id: sub}
        logger.warning(
            "aquaculture-linked invoice %s: missing revenue COA %s or zero subtotal; falling back to default splits",
            inv.id,
            code,
        )
    lines = list(
        InvoiceLine.objects.filter(invoice_id=inv.id).select_related("item", "revenue_account")
    )
    if not lines:
        acc = _revenue_account_for_item(company_id, None)
        if acc:
            amounts[acc.id] = inv.subtotal
        return dict(amounts)
    for line in lines:
        acc = None
        if getattr(line, "revenue_account_id", None):
            ra = ChartOfAccount.objects.filter(
                pk=line.revenue_account_id, company_id=company_id, is_active=True
            ).first()
            if ra and is_pl_credit_normal_type(ra.account_type):
                acc = ra
        if acc is None:
            acc = _revenue_account_for_item(company_id, line.item)
        if acc:
            amounts[acc.id] += line.amount or Decimal("0")
    total_lines = sum(amounts.values(), Decimal("0"))
    if total_lines <= 0 and inv.subtotal > 0:
        acc = _revenue_account_for_item(company_id, None)
        if acc:
            amounts[acc.id] = inv.subtotal
        return dict(amounts)
    # Scale to match invoice.subtotal if rounding drift
    if inv.subtotal and total_lines and abs(total_lines - inv.subtotal) > Decimal("0.02"):
        factor = inv.subtotal / total_lines
        scaled: dict[int, Decimal] = {}
        for aid, amt in amounts.items():
            scaled[aid] = (amt * factor).quantize(Decimal("0.01"))
        amounts = defaultdict(lambda: Decimal("0"), scaled)
    return dict(amounts)


def _create_posted_entry(
    company_id: int,
    entry_date,
    entry_number: str,
    description: str,
    lines: list[tuple],
    *,
    gl_station_id: Optional[int] = None,
    aquaculture_line_costing: Optional[list[Optional[dict]]] = None,
) -> Optional[JournalEntry]:
    total_debit = sum(_unpack_gl_line(x)[1] for x in lines)
    total_credit = sum(_unpack_gl_line(x)[2] for x in lines)
    if total_debit != total_credit or total_debit <= 0:
        logger.warning(
            "skip journal %s: unbalanced or zero (debit=%s credit=%s)",
            entry_number,
            total_debit,
            total_credit,
        )
        return None
    with transaction.atomic():
        if JournalEntry.objects.filter(
            company_id=company_id, entry_number=entry_number
        ).exists():
            return JournalEntry.objects.filter(
                company_id=company_id, entry_number=entry_number
            ).first()
        je = JournalEntry(
            company_id=company_id,
            entry_number=entry_number,
            entry_date=entry_date,
            description=description[:500],
            station_id=_gl_station_id(company_id, gl_station_id),
            is_posted=True,
            posted_at=timezone.now(),
        )
        je.save()
        hdr = _gl_station_id(company_id, gl_station_id)
        meta_list = aquaculture_line_costing or []
        for i, raw in enumerate(lines):
            acc, debit, credit, desc, st_opt, explicit = _unpack_gl_line(raw)
            if explicit:
                line_st = _gl_station_id(company_id, st_opt) if st_opt is not None else None
            else:
                line_st = hdr
            aq_meta = meta_list[i] if i < len(meta_list) else None
            aq_kw = _journal_line_bill_meta_kwargs(company_id, aq_meta)
            JournalEntryLine.objects.create(
                journal_entry=je,
                account=acc,
                station_id=line_st,
                debit=debit,
                credit=credit,
                description=desc[:300],
                **aq_kw,
            )
        return je


def post_invoice_cogs_journal(company_id: int, inv: Invoice) -> bool:
    """
    Dr COGS / Cr inventory at average cost (item.cost x qty) for perpetual-inventory items.

    Skips service and non-inventory lines (no inventory asset to relieve). Idempotent:
    AUTO-INV-{id}-COGS.
    """
    if inv.status == "draft" or inv.total <= 0:
        return False
    entry_number = f"AUTO-INV-{inv.id}-COGS"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True

    validate_invoice_entity_tags_for_gl(company_id, inv)

    # Split by COGS account, inventory account, and aquaculture cost bucket so mixed feed/medicine lines stay tagged.
    buckets: dict[tuple[int, int, str], Decimal] = {}
    total_cogs = Decimal("0")
    for line in InvoiceLine.objects.filter(invoice_id=inv.id).select_related("item"):
        it = line.item
        if not it:
            continue
        if not item_should_relieve_cogs(company_id, it):
            continue
        cost = item_cogs_unit_cost(company_id, it)
        if cost <= 0:
            continue
        qty = line.quantity or Decimal("0")
        amt = (qty * cost).quantize(Decimal("0.01"))
        if amt <= 0:
            continue
        inv_acc = _inventory_account_for_item(company_id, it)
        cogs_acc = _cogs_account_for_item(company_id, it)
        if not inv_acc or not cogs_acc:
            continue
        bkt = item_shop_issue_cost_bucket(it)
        key = (cogs_acc.id, inv_acc.id, bkt)
        buckets[key] = buckets.get(key, Decimal("0")) + amt
        total_cogs += amt

    if total_cogs <= 0:
        return False

    pond_id, cycle_id = _invoice_aquaculture_pond_cycle(company_id, inv)

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    aq_costing: list[Optional[dict]] = []
    for (cogs_id, inv_id, bkt), amt in buckets.items():
        cogs = ChartOfAccount.objects.filter(
            id=cogs_id, company_id=company_id, is_active=True
        ).first()
        inv_a = ChartOfAccount.objects.filter(
            id=inv_id, company_id=company_id, is_active=True
        ).first()
        if not cogs or not inv_a:
            continue
        memo = _gl_invoice_line_memo(inv, "COGS")
        lines.append((cogs, amt, Decimal("0"), memo))
        lines.append((inv_a, Decimal("0"), amt, memo))
        aq_meta: Optional[dict] = None
        if pond_id:
            aq_meta = {"pond_id": pond_id, "cost_bucket": bkt}
            if cycle_id:
                aq_meta["production_cycle_id"] = cycle_id
        aq_costing.append(aq_meta)
        aq_costing.append(aq_meta)

    if not lines:
        return False
    debit = sum(_unpack_gl_line(x)[1] for x in lines)
    credit = sum(_unpack_gl_line(x)[2] for x in lines)
    if debit != credit:
        return False

    inv_st = _gl_station_id(company_id, inv.station_id)
    return (
        _create_posted_entry(
            company_id,
            inv.invoice_date,
            entry_number,
            _gl_invoice_journal_description(inv, "COGS"),
            lines,
            gl_station_id=inv_st,
            aquaculture_line_costing=aq_costing,
        )
        is not None
    )


def delete_invoice_cogs_journal(company_id: int, invoice_id: int) -> int:
    """Remove AUTO-INV-{id}-COGS (e.g. before repost after item cost fix)."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-INV-{invoice_id}-COGS",
    ).delete()
    return deleted


def backfill_invoice_cogs_journals(
    company_id: int,
    start: date,
    end: date,
    *,
    force_repost: bool = False,
) -> dict[str, int]:
    """
    Post missing COGS relief journals for posted invoices in [start, end].
    Skips draft/zero-total invoices. With force_repost, deletes existing COGS entries first.
    """
    posted = 0
    skipped = 0
    removed = 0
    qs = (
        Invoice.objects.filter(
            company_id=company_id,
            invoice_date__gte=start,
            invoice_date__lte=end,
        )
        .exclude(status="draft")
        .exclude(total__lte=0)
        .order_by("id")
    )
    for inv in qs.iterator(chunk_size=200):
        en = f"AUTO-INV-{inv.id}-COGS"
        if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
            if not force_repost:
                skipped += 1
                continue
            removed += delete_invoice_cogs_journal(company_id, inv.id)
        if post_invoice_cogs_journal(company_id, inv):
            posted += 1
    return {"posted": posted, "skipped_existing": skipped, "removed_for_repost": removed}


def post_aquaculture_shop_stock_issue_journal(
    company_id: int,
    expense_id: int,
    entry_date: date,
    station_id: int | None,
    line_rows: list[tuple[Item, Decimal]],
) -> bool:
    """
    Dr COGS / Cr inventory at average cost for shop stock issued to pond operations (no POS invoice).

    Idempotent: entry_number AUTO-AQ-SHOP-{expense_id}-COGS.
    """
    entry_number = f"AUTO-AQ-SHOP-{expense_id}-COGS"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return True

    buckets: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))
    for it, qty in line_rows:
        if not item_tracks_physical_stock(it):
            continue
        uc = item_cogs_unit_cost(company_id, it)
        if uc <= 0:
            continue
        q = qty if qty is not None else Decimal("0")
        amt = (q * uc).quantize(Decimal("0.01"))
        if amt <= 0:
            continue
        inv_acc = _inventory_account_for_item(company_id, it)
        cogs_acc = _cogs_account_for_item(company_id, it)
        if not inv_acc or not cogs_acc:
            continue
        key = (cogs_acc.id, inv_acc.id)
        buckets[key] = buckets.get(key, Decimal("0")) + amt

    if not buckets:
        return False

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    aq_costing: list[Optional[dict]] = []
    exp_row = AquacultureExpense.objects.filter(pk=expense_id, company_id=company_id).first()
    aq_meta: dict | None = None
    if exp_row and exp_row.pond_id:
        aq_meta = {
            "pond_id": exp_row.pond_id,
            "production_cycle_id": exp_row.production_cycle_id,
            "cost_bucket": aquaculture_expense_category_to_cost_bucket(
                exp_row.expense_category, company_id=company_id
            ),
        }
    for (cogs_id, inv_id), amt in buckets.items():
        cogs = ChartOfAccount.objects.filter(
            id=cogs_id, company_id=company_id, is_active=True
        ).first()
        inv_a = ChartOfAccount.objects.filter(
            id=inv_id, company_id=company_id, is_active=True
        ).first()
        if not cogs or not inv_a:
            continue
        memo = f"Aquaculture shop issue (expense {expense_id})"[:300]
        lines.append((cogs, amt, Decimal("0"), memo))
        lines.append((inv_a, Decimal("0"), amt, memo))
        aq_costing.append(aq_meta)
        aq_costing.append(aq_meta)

    if not lines:
        return False
    debit = sum(_unpack_gl_line(x)[1] for x in lines)
    credit = sum(_unpack_gl_line(x)[2] for x in lines)
    if debit != credit or debit <= 0:
        return False

    desc = f"Aquaculture — shop stock to pond (operating expense #{expense_id})"[:500]
    inv_st = _gl_station_id(company_id, station_id)
    return (
        _create_posted_entry(
            company_id,
            entry_date,
            entry_number,
            desc,
            lines,
            gl_station_id=inv_st,
            aquaculture_line_costing=aq_costing,
        )
        is not None
    )


def post_aquaculture_pond_feed_consumption_journal(
    company_id: int,
    expense_id: int,
    entry_date: date,
    line_rows: list[tuple[Item, Decimal]],
) -> bool:
    """
    Dr COGS / Cr inventory at average cost when feed or medicine is consumed from a pond warehouse (no POS invoice).

    Idempotent: entry_number AUTO-AQ-POND-{expense_id}-COGS.
    """
    entry_number = f"AUTO-AQ-POND-{expense_id}-COGS"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return True

    buckets: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))
    for it, qty in line_rows:
        if not item_tracks_physical_stock(it):
            continue
        uc = item_cogs_unit_cost(company_id, it)
        if uc <= 0:
            continue
        q = qty if qty is not None else Decimal("0")
        amt = (q * uc).quantize(Decimal("0.01"))
        if amt <= 0:
            continue
        inv_acc = _inventory_account_for_item(company_id, it)
        cogs_acc = _cogs_account_for_item(company_id, it)
        if not inv_acc or not cogs_acc:
            continue
        key = (cogs_acc.id, inv_acc.id)
        buckets[key] = buckets.get(key, Decimal("0")) + amt

    if not buckets:
        return False

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    aq_costing: list[Optional[dict]] = []
    exp_row = AquacultureExpense.objects.filter(pk=expense_id, company_id=company_id).first()
    cat = (exp_row.expense_category if exp_row else "") or ""
    if cat == "medicine_consumed":
        line_memo = f"Aquaculture pond medicine consumption (expense {expense_id})"[:300]
        desc = f"Aquaculture — pond warehouse medicine consumption (expense #{expense_id})"[:500]
    else:
        line_memo = f"Aquaculture pond feed consumption (expense {expense_id})"[:300]
        desc = f"Aquaculture — pond warehouse feed consumption (expense #{expense_id})"[:500]
    aq_meta: dict | None = None
    if exp_row and exp_row.pond_id:
        aq_meta = {
            "pond_id": exp_row.pond_id,
            "production_cycle_id": exp_row.production_cycle_id,
            "cost_bucket": aquaculture_expense_category_to_cost_bucket(
                exp_row.expense_category, company_id=company_id
            ),
        }
    for (cogs_id, inv_id), amt in buckets.items():
        cogs = ChartOfAccount.objects.filter(
            id=cogs_id, company_id=company_id, is_active=True
        ).first()
        inv_a = ChartOfAccount.objects.filter(
            id=inv_id, company_id=company_id, is_active=True
        ).first()
        if not cogs or not inv_a:
            continue
        lines.append((cogs, amt, Decimal("0"), line_memo))
        lines.append((inv_a, Decimal("0"), amt, line_memo))
        aq_costing.append(aq_meta)
        aq_costing.append(aq_meta)

    if not lines:
        return False
    debit = sum(_unpack_gl_line(x)[1] for x in lines)
    credit = sum(_unpack_gl_line(x)[2] for x in lines)
    if debit != credit or debit <= 0:
        return False
    return (
        _create_posted_entry(
            company_id,
            entry_date,
            entry_number,
            desc,
            lines,
            gl_station_id=None,
            aquaculture_line_costing=aq_costing,
        )
        is not None
    )


def post_aquaculture_manual_expense_journal(
    company_id: int,
    expense_id: int,
    entry_date: date,
) -> bool:
    """
    Dr pond operating-expense account / Cr funding account (cash or bank) for a manual pond expense
    that is NOT backed by inventory consumption or a shop-stock issue.

    Posts only when the expense carries a ``funding_account_code`` and a direct pond (single entity),
    so inventory-backed (AUTO-AQ-POND/SHOP) and vendor-bill (A/P) paths are never double-counted.
    Idempotent: entry_number AUTO-AQ-EXP-{expense_id}.
    """
    entry_number = f"AUTO-AQ-EXP-{expense_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return True

    exp_row = AquacultureExpense.objects.filter(pk=expense_id, company_id=company_id).first()
    if not exp_row:
        return False
    funding_code = (exp_row.funding_account_code or "").strip()
    if not funding_code:
        return False
    # Inventory-backed or shop-issue costs already post their own COGS journal — never double-post.
    if exp_row.source_station_id is not None:
        return False
    if AquacultureExpenseInventoryLine.objects.filter(expense_id=expense_id).exists():
        return False
    if exp_row.pond_id is None:
        return False
    amt = (exp_row.amount or Decimal("0")).quantize(Decimal("0.01"))
    if amt <= 0:
        return False

    expense_code = coa_account_code_for_aquaculture_expense_category(
        exp_row.expense_category, company_id=company_id
    )
    exp_acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=expense_code, is_active=True
    ).first()
    fund_acc = ChartOfAccount.objects.filter(
        company_id=company_id, account_code=funding_code, is_active=True
    ).first()
    if not exp_acc or not fund_acc:
        logger.warning(
            "skip aquaculture manual expense journal %s: missing COA (expense %s, funding %s)",
            entry_number,
            expense_code,
            funding_code,
        )
        return False

    from api.services.tenant_reporting_categories import aquaculture_expense_label

    label = aquaculture_expense_label(company_id, exp_row.expense_category)
    line_memo = f"Aquaculture pond expense — {label} (expense {expense_id})"[:300]
    desc = f"Aquaculture — pond {label} paid from {funding_code} (expense #{expense_id})"[:500]
    aq_meta = {
        "pond_id": exp_row.pond_id,
        "production_cycle_id": exp_row.production_cycle_id,
        "cost_bucket": aquaculture_expense_category_to_cost_bucket(
            exp_row.expense_category, company_id=company_id
        ),
    }
    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (exp_acc, amt, Decimal("0"), line_memo),
        (fund_acc, Decimal("0"), amt, line_memo),
    ]
    return (
        _create_posted_entry(
            company_id,
            entry_date,
            entry_number,
            desc,
            lines,
            gl_station_id=None,
            aquaculture_line_costing=[aq_meta, None],
        )
        is not None
    )


def post_aquaculture_fish_stock_ledger_journal(
    company_id: int,
    ledger_id: int,
    entry_date: date,
    *,
    is_write_down: bool,
    book_value: Decimal,
    pond_label: str,
    line_memo: str,
    credit_opening_equity: bool = False,
) -> JournalEntry | None:
    """
    Idempotent entry_number AUTO-AQ-BIOSTK-{ledger_id}.

    Write-down (mortality / negative adjustment with value): Dr 6726 / Cr 1581.
    Count gain (positive adjustment with value): Dr 1581 / Cr 4244.
    Go-live / opening biomass (credit_opening_equity=True): Dr 1581 / Cr 3200 Opening Balance Equity.
    """
    entry_number = f"AUTO-AQ-BIOSTK-{ledger_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).first()

    amt = book_value.quantize(Decimal("0.01"))
    if amt <= 0:
        return None

    bio = ChartOfAccount.objects.filter(company_id=company_id, account_code="1581", is_active=True).first()
    exp = ChartOfAccount.objects.filter(company_id=company_id, account_code="6726", is_active=True).first()
    gain = ChartOfAccount.objects.filter(company_id=company_id, account_code="4244", is_active=True).first()
    equity = None
    if credit_opening_equity and not is_write_down:
        from api.services.loan_counterparty_opening import resolve_opening_balance_equity

        equity = resolve_opening_balance_equity(company_id)
    if not bio or (is_write_down and not exp) or (not is_write_down and credit_opening_equity and not equity) or (
        not is_write_down and not credit_opening_equity and not gain
    ):
        logger.warning(
            "skip aquaculture fish stock journal %s: missing COA (1581%s)",
            entry_number,
            ", 6726" if is_write_down else (", 3200" if credit_opening_equity else ", 4244"),
        )
        return None

    memo = (line_memo or f"Aquaculture fish stock #{ledger_id}")[:300]
    led_row = AquacultureFishStockLedger.objects.filter(pk=ledger_id, company_id=company_id).first()
    aq_meta: dict | None = None
    if led_row and led_row.pond_id:
        aq_meta = {
            "pond_id": led_row.pond_id,
            "production_cycle_id": led_row.production_cycle_id,
            "cost_bucket": "biological_writeoff" if is_write_down else "biological_gain",
        }
    if is_write_down:
        lines = [
            (exp, amt, Decimal("0"), memo),
            (bio, Decimal("0"), amt, memo),
        ]
        desc = f"Aquaculture — biological shrinkage ({pond_label})"[:500]
    elif credit_opening_equity:
        lines = [
            (bio, amt, Decimal("0"), memo),
            (equity, Decimal("0"), amt, memo),
        ]
        desc = f"Aquaculture — biological inventory opening ({pond_label})"[:500]
    else:
        lines = [
            (bio, amt, Decimal("0"), memo),
            (gain, Decimal("0"), amt, memo),
        ]
        desc = f"Aquaculture — biological count gain ({pond_label})"[:500]

    aq_costing = [aq_meta, aq_meta] if aq_meta else [None, None]

    return _create_posted_entry(
        company_id,
        entry_date,
        entry_number,
        desc,
        lines,
        gl_station_id=None,
        aquaculture_line_costing=aq_costing,
    )


def post_aquaculture_fish_sale_bio_relief_journal(
    company_id: int,
    sale_id: int,
    entry_date: date,
    *,
    relief_amount: Decimal,
    pond_id: int,
    production_cycle_id: int | None,
    pond_label: str,
    weight_kg: Decimal,
    cost_per_kg: Decimal,
    memo: str = "",
) -> JournalEntry | None:
    """
    Idempotent entry_number AUTO-AQ-SALE-{sale_id}-BIO.

    Harvest bio-asset relief at accumulated production cost/kg: Dr 6726 / Cr 1581.
    """
    entry_number = f"AUTO-AQ-SALE-{sale_id}-BIO"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).first()

    amt = relief_amount.quantize(Decimal("0.01"))
    if amt <= 0:
        return None

    bio = ChartOfAccount.objects.filter(company_id=company_id, account_code="1581", is_active=True).first()
    exp = ChartOfAccount.objects.filter(company_id=company_id, account_code="6726", is_active=True).first()
    if not bio or not exp:
        logger.warning(
            "skip aquaculture fish sale bio relief %s: missing COA (1581, 6726)",
            entry_number,
        )
        return None

    line_memo = (
        memo
        or f"Harvest bio-asset relief — {weight_kg} kg @ {cost_per_kg}/kg"
    )[:300]
    aq_meta = {
        "pond_id": pond_id,
        "production_cycle_id": production_cycle_id,
        "cost_bucket": "biological_writeoff",
    }
    lines = [
        (exp, amt, Decimal("0"), line_memo),
        (bio, Decimal("0"), amt, line_memo),
    ]
    desc = f"Aquaculture — harvest bio-asset relief ({pond_label})"[:500]
    return _create_posted_entry(
        company_id,
        entry_date,
        entry_number,
        desc,
        lines,
        gl_station_id=None,
        aquaculture_line_costing=[aq_meta, aq_meta],
    )


def delete_aquaculture_fish_sale_bio_relief_journal(company_id: int, sale_id: int) -> int:
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-AQ-SALE-{sale_id}-BIO",
    ).delete()
    return deleted


def delete_auto_fund_transfer_journal(company_id: int, transfer_id: int) -> int:
    """Remove GL entry for a fund transfer when unposting the transfer."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-FT-{transfer_id}",
    ).delete()
    return deleted


def post_invoice_sale_journal(
    company_id: int,
    inv: Invoice,
    *,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> bool:
    """
    Post revenue recognition for invoice (cash sale or AR).
    Idempotent via entry_number AUTO-INV-{id}-SALE.
    """
    if inv.status == "draft" or inv.total <= 0:
        return False
    entry_number = f"AUTO-INV-{inv.id}-SALE"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        post_invoice_cogs_journal(company_id, inv)
        return True

    validate_invoice_entity_tags_for_gl(company_id, inv)

    vat_acc = _coa(company_id, CODE_VAT)
    rev_splits = _build_revenue_splits(company_id, inv)
    if not rev_splits:
        logger.warning("post_invoice_sale_journal: no revenue accounts for company %s", company_id)
        return False

    tax = inv.tax_total or Decimal("0")
    total = inv.total

    debit_acc: Optional[ChartOfAccount] = None
    if inv.status == "paid":
        debit_acc = _debit_account_for_paid_sale(
            company_id, payment_method, bank_account_id
        )
    elif inv.status in ("sent", "partial", "overdue"):
        debit_acc = _coa(company_id, CODE_AR)
    else:
        return False

    if not debit_acc:
        logger.warning(
            "post_invoice_sale_journal: missing debit account for inv %s status %s",
            inv.id,
            inv.status,
        )
        return False

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (debit_acc, total, Decimal("0"), _gl_invoice_line_memo(inv))
    ]
    for acc_id, amt in rev_splits.items():
        acc = ChartOfAccount.objects.filter(
            id=acc_id, company_id=company_id, is_active=True
        ).first()
        if not acc or amt <= 0:
            continue
        lines.append(
            (acc, Decimal("0"), amt, _gl_invoice_line_memo(inv))
        )
    if tax > 0 and vat_acc:
        lines.append(
            (vat_acc, Decimal("0"), tax, _gl_invoice_line_memo(inv, "VAT"))
        )

    credit_sum = sum(x[2] for x in lines[1:])
    debit_sum = lines[0][1]
    if credit_sum != debit_sum:
        # Adjust largest revenue line
        diff = debit_sum - credit_sum
        if len(lines) > 1:
            for i in range(1, len(lines)):
                acc, d, c, desc, st_line, expl = _unpack_gl_line(lines[i])
                if c > 0:
                    if expl:
                        lines[i] = (acc, d, (c + diff).quantize(Decimal("0.01")), desc, st_line)
                    else:
                        lines[i] = (acc, d, (c + diff).quantize(Decimal("0.01")), desc)
                    break
        credit_sum = sum(x[2] for x in lines[1:])
    if debit_sum != credit_sum:
        logger.warning(
            "post_invoice_sale_journal: still unbalanced inv %s debit=%s credit=%s",
            inv.id,
            debit_sum,
            credit_sum,
        )
        return False

    pond_id, cycle_id = _invoice_aquaculture_pond_cycle(company_id, inv)
    aq_sale = (
        AquacultureFishSale.objects.filter(invoice_id=inv.id, company_id=company_id)
        .only("income_type")
        .first()
    )
    aq_line_meta: list[Optional[dict]] = []
    if pond_id is not None:
        base: dict[str, Any] = {"pond_id": pond_id}
        if cycle_id:
            base["production_cycle_id"] = cycle_id
        for i, raw in enumerate(lines):
            _, _debit, credit, _, _, _ = _unpack_gl_line(raw)
            meta = dict(base)
            if i > 0 and (credit or Decimal("0")) > 0:
                if aq_sale is not None:
                    meta["cost_bucket"] = _aquaculture_revenue_cost_bucket(aq_sale.income_type)
                else:
                    meta["cost_bucket"] = "rev_pos_sale"
            aq_line_meta.append(meta)
    else:
        aq_line_meta = [None] * len(lines)

    inv_st = _gl_station_id(company_id, inv.station_id)
    je = _create_posted_entry(
        company_id,
        inv.invoice_date,
        entry_number,
        _gl_invoice_journal_description(inv, "Invoice"),
        lines,
        gl_station_id=inv_st,
        aquaculture_line_costing=aq_line_meta,
    )
    if je:
        post_invoice_cogs_journal(company_id, inv)
    if je and inv.status in ("sent", "partial", "overdue") and not _is_walkin_customer(
        inv.customer
    ):
        Customer.objects.filter(pk=inv.customer_id).update(
            current_balance=F("current_balance") + total
        )
    return je is not None


def invoice_sale_used_ar(company_id: int, invoice_id: int) -> bool:
    ar = _coa(company_id, CODE_AR)
    if not ar:
        return False
    je = (
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-INV-{invoice_id}-SALE"
        )
        .prefetch_related("lines")
        .first()
    )
    if not je:
        return False
    return any(
        line.account_id == ar.id and (line.debit or 0) > 0 for line in je.lines.all()
    )


def post_invoice_receipt_journal(
    company_id: int,
    inv: Invoice,
    *,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> bool:
    """Dr Cash/Bank, Cr AR for remaining AR after payment allocations. AUTO-INV-{id}-RCPT."""
    if inv.status != "paid":
        return False
    if not invoice_sale_used_ar(company_id, inv.id):
        return False
    sale_ref = f"AUTO-INV-{inv.id}-SALE"
    if not JournalEntry.objects.filter(
        company_id=company_id, entry_number=sale_ref
    ).exists():
        return False
    entry_number = f"AUTO-INV-{inv.id}-RCPT"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True

    from api.services.payment_allocation import total_allocated_to_invoice

    allocated = total_allocated_to_invoice(company_id, inv.id)
    amt = (inv.total or Decimal("0")) - allocated
    if amt <= 0:
        return True

    ar = _coa(company_id, CODE_AR)
    cash_bank = _debit_account_for_paid_sale(
        company_id, payment_method, bank_account_id
    )
    if not ar or not cash_bank:
        return False

    rcpt = _gl_invoice_line_memo(inv, "Receipt")
    lines = [
        (cash_bank, amt, Decimal("0"), rcpt),
        (ar, Decimal("0"), amt, rcpt),
    ]
    inv_st = _gl_station_id(company_id, inv.station_id)
    je = _create_posted_entry(
        company_id,
        inv.invoice_date,
        entry_number,
        _gl_invoice_journal_description(inv, "Payment for"),
        lines,
        gl_station_id=inv_st,
    )
    if je and not _is_walkin_customer(inv.customer):
        Customer.objects.filter(pk=inv.customer_id).update(
            current_balance=F("current_balance") - amt
        )
    return je is not None


def post_payment_received_journal(company_id: int, p: Payment) -> bool:
    """Dr Bank, Cr AR. AUTO-PAY-{id}-RCV. Raises GlPostingError if a new post cannot be created."""
    if p.payment_type != "received" or p.amount <= 0:
        return False
    entry_number = f"AUTO-PAY-{p.id}-RCV"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True
    ar = _coa(company_id, CODE_AR)
    if not ar:
        raise GlPostingError(
            "G/L: Accounts Receivable (code 1100) is missing or inactive. Add or enable it in the "
            "chart of accounts before recording customer payments."
        )
    # Undeposited clearing (1020) before till cash (1010) when both exist and no bank register — matches UI.
    pm = (getattr(p, "payment_method", None) or "cash").strip().lower() or "cash"
    cash_bank = _debit_account_for_paid_sale(
        company_id,
        pm,
        p.bank_account_id,
        prefer_undeposited_clearing=True,
    )
    if not cash_bank:
        raise GlPostingError(
            "G/L: No debit (cash) account for this payment method. Ensure account 1010 (Cash on Hand) "
            "or 1020/1120, or a bank/till register linked to a G/L line, is available."
        )
    lines = [
        (cash_bank, p.amount, Decimal("0"), p.reference or f"PAY-{p.id}"),
        (ar, Decimal("0"), p.amount, p.reference or f"PAY-{p.id}"),
    ]
    pst = _gl_station_id(company_id, p.station_id)
    je = _create_posted_entry(
        company_id,
        p.payment_date,
        entry_number,
        f"Payment received #{p.id}",
        lines,
        gl_station_id=pst,
    )
    if not je:
        raise GlPostingError(
            "G/L: The payment journal was not created (unbalanced or invalid lines). Check chart of accounts."
        )
    if je and p.customer_id and not _is_walkin_customer(
        Customer.objects.filter(pk=p.customer_id).first()
    ):
        Customer.objects.filter(pk=p.customer_id).update(
            current_balance=F("current_balance") - p.amount
        )
    return True


def reverse_payment_received_posting(company_id: int, p: Payment) -> tuple[bool, str]:
    """
    Remove AUTO-PAY-{id}-RCV and restore customer AR subledger (inverse of post_payment_received_journal).
    Does not delete the Payment row.
    """
    if p.payment_type != Payment.PAYMENT_TYPE_RECEIVED:
        return False, "not a received payment"
    entry_number = f"AUTO-PAY-{p.id}-RCV"
    je = JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).first()
    had_je = je is not None
    if je:
        je.delete()
    cust = Customer.objects.filter(pk=p.customer_id).first() if p.customer_id else None
    if had_je and p.customer_id and not _is_walkin_customer(cust):
        Customer.objects.filter(pk=p.customer_id).update(
            current_balance=F("current_balance") + (p.amount or Decimal("0"))
        )
    return True, ""


def reverse_payment_made_posting(company_id: int, p: Payment) -> tuple[bool, str]:
    """
    Remove AUTO-PAY-{id}-MADE and restore vendor A/P subledger when it was decremented.
    Does not delete the Payment row.
    """
    if p.payment_type != Payment.PAYMENT_TYPE_MADE:
        return False, "not a made payment"
    entry_number = f"AUTO-PAY-{p.id}-MADE"
    je = JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).first()
    had_je = je is not None
    if je:
        je.delete()
    if p.vendor_id and (p.vendor_ap_decremented or had_je):
        Vendor.objects.filter(pk=p.vendor_id).update(
            current_balance=F("current_balance") + (p.amount or Decimal("0"))
        )
        Payment.objects.filter(pk=p.pk).update(vendor_ap_decremented=False)
    return True, ""


def post_payment_made_journal(company_id: int, p: Payment) -> bool:
    """
    Dr AP, Cr Bank. AUTO-PAY-{id}-MADE. Raises GlPostingError if a new post cannot be created;
    A/P subledger is only updated when a journal (or an idempotent prior journal) is in place.
    """
    if p.payment_type != "made" or p.amount <= 0:
        return False
    entry_number = f"AUTO-PAY-{p.id}-MADE"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        with transaction.atomic():
            lp = Payment.objects.select_for_update().filter(pk=p.pk).first()
            if (
                lp
                and lp.vendor_id
                and lp.payment_type == Payment.PAYMENT_TYPE_MADE
                and not lp.vendor_ap_decremented
            ):
                Vendor.objects.filter(pk=lp.vendor_id).update(
                    current_balance=F("current_balance") - lp.amount
                )
                Payment.objects.filter(pk=lp.pk).update(vendor_ap_decremented=True)
        return True
    ap = _coa(company_id, CODE_AP)
    if not ap:
        raise GlPostingError(
            "G/L: Accounts Payable (code 2000) is missing or inactive. Add or enable it in the "
            "chart of accounts before recording vendor payments."
        )
    pm = (getattr(p, "payment_method", None) or "cash").strip().lower() or "cash"
    cash_bank = _debit_account_for_paid_sale(company_id, pm, p.bank_account_id)
    if not cash_bank:
        raise GlPostingError(
            "G/L: No credit (bank/cash) line for this payment. Ensure 1010/1030, card clearing, or a "
            "register linked to the chart, is available for vendor payments."
        )
    lines = [
        (ap, p.amount, Decimal("0"), p.reference or f"PAY-{p.id}"),
        (cash_bank, Decimal("0"), p.amount, p.reference or f"PAY-{p.id}"),
    ]
    pst = _gl_station_id(company_id, p.station_id)
    je = _create_posted_entry(
        company_id,
        p.payment_date,
        entry_number,
        f"Payment made #{p.id}",
        lines,
        gl_station_id=pst,
    )
    if not je:
        raise GlPostingError(
            "G/L: The vendor payment journal was not created (unbalanced or invalid). Check the chart of accounts."
        )
    with transaction.atomic():
        lp = Payment.objects.select_for_update().filter(pk=p.pk).first()
        if (
            lp
            and lp.vendor_id
            and lp.payment_type == Payment.PAYMENT_TYPE_MADE
            and not lp.vendor_ap_decremented
        ):
            Vendor.objects.filter(pk=lp.vendor_id).update(
                current_balance=F("current_balance") - lp.amount
            )
            Payment.objects.filter(pk=lp.pk).update(vendor_ap_decremented=True)
    return True


def _normalize_label(s: str) -> str:
    """Lowercase, collapse whitespace (matches 'Diesel Tank 1' vs 'Diesel  Tank  1')."""
    return " ".join((s or "").strip().lower().split())


def _pick_tank_for_bill_line(line: BillLine, item: Item, tanks_qs):
    """
    Prefer line.tank_id when valid; else tank whose name starts with / contains the product name
    (e.g. Diesel -> Diesel Tank 1); else first tank by tank_name then id.
    """
    if line.tank_id:
        t = tanks_qs.filter(pk=line.tank_id).first()
        if t:
            return t
    name = _normalize_label(item.name or "")
    ordered = list(tanks_qs.order_by("tank_name", "id"))
    if not ordered:
        return None
    if name:
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            if tn.startswith(name):
                return t
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            if name in tn:
                return t
        words = [w for w in name.replace("-", " ").split() if len(w) > 1]
        for t in ordered:
            tn = _normalize_label(t.tank_name or "")
            for w in words:
                if w in tn:
                    return t
    return ordered[0]


def _item_receives_physical_stock(item: Optional[Item]) -> bool:
    """
    True if a vendor bill line or POS line should move physical stock (tank and/or QOH).

    Delegates to item_catalog.item_tracks_physical_stock: **inventory** only, plus legacy
    fuel heuristics for old rows; **service** and **non_inventory** never.
    """
    return item_tracks_physical_stock(item)


def _bill_line_physical_receipt_quantity(line: BillLine, item: Item) -> Decimal:
    """
    Units to receive for a vendor bill line. Fish-type SKUs use headcount when set — line
    quantity is often one batch while aquaculture_fish_count is the biological stocking.
    """
    base = line.quantity if line.quantity is not None else Decimal("0")
    if (getattr(item, "pos_category", None) or "").strip().lower() != "fish":
        return base
    fc = getattr(line, "aquaculture_fish_count", None)
    if fc is None:
        return base
    try:
        n = int(fc)
    except (TypeError, ValueError):
        return base
    if n > 0:
        return Decimal(n)
    return base


def _tanks_for_stock_receipt(company_id: int, item: Item):
    """Active tanks for this product; if none and item is fuel-like, include inactive (so receipt still lands)."""
    qs = Tank.objects.filter(
        company_id=company_id, product_id=item.id, is_active=True
    )
    if qs.exists():
        return qs
    if _item_receives_physical_stock(item):
        return Tank.objects.filter(company_id=company_id, product_id=item.id).order_by(
            "-is_active", "tank_name", "id"
        )
    return Tank.objects.none()


def _sync_item_qoh_from_tanks(company_id: int, item_id: int) -> None:
    """Align Item.quantity_on_hand with tank totals (active tanks if any; else all tanks)."""
    active = Tank.objects.filter(
        company_id=company_id, product_id=item_id, is_active=True
    )
    if active.exists():
        agg = active.aggregate(s=Sum("current_stock"))["s"]
    else:
        agg = Tank.objects.filter(company_id=company_id, product_id=item_id).aggregate(
            s=Sum("current_stock")
        )["s"]
    total = agg if agg is not None else Decimal("0")
    Item.objects.filter(pk=item_id, company_id=company_id).update(quantity_on_hand=total)


def receipt_inventory_from_posted_bill(
    bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> int:
    """
    When a vendor bill is posted, increase stock for inventory / fuel lines.
    Fuel (items linked to tanks): add quantity to the line's tank (explicit id or best match by name),
    then sync Item.quantity_on_hand from tank totals. Non-tank inventory: Item.quantity_on_hand only.
    Returns the number of bill lines that applied a stock movement.
    """
    from api.services.inventory_validation import lock_tanks_and_assert_receipt_capacity

    lock_tanks_and_assert_receipt_capacity(
        bill, acknowledge_tank_overfill=acknowledge_tank_overfill
    )
    applied_lines = 0
    company_id = bill.company_id
    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item", "tank"):
        item = line.item
        if not item:
            continue
        qty = _bill_line_physical_receipt_quantity(line, item)
        if qty <= 0:
            continue
        if not _item_receives_physical_stock(item):
            continue
        applied_lines += 1
        # Moving weighted-average cost (AVCO): update unit cost BEFORE on-hand is incremented.
        apply_weighted_average_cost_on_receipt(
            company_id, item.id, qty, line.amount if line.amount is not None else Decimal("0")
        )
        tanks_qs = _tanks_for_stock_receipt(company_id, item)
        if tanks_qs.exists():
            tank = _pick_tank_for_bill_line(line, item, tanks_qs)
            if tank:
                Tank.objects.filter(pk=tank.pk).update(current_stock=F("current_stock") + qty)
                _sync_item_qoh_from_tanks(company_id, item.id)
        else:
            from api.services.station_stock import (
                add_station_stock,
                get_or_create_default_station,
                item_uses_station_bins,
            )

            # Fish / hatchery SKUs (pos_category fish, non_pos, …) do not use shop station bins;
            # physical qty belongs in ItemPondStock when the line tags a pond (e.g. fry to nursing pond).
            if not item_uses_station_bins(company_id, item):
                pond_id = getattr(line, "aquaculture_pond_id", None)
                if pond_id:
                    from api.services.aquaculture_pond_stock_service import add_pond_stock

                    add_pond_stock(company_id, int(pond_id), item.id, qty)
                else:
                    st_id = _bill_line_receipt_station_id(line, bill)
                    if not st_id:
                        st_id = get_or_create_default_station(company_id).id
                    add_station_stock(company_id, st_id, item.id, qty)
            else:
                st_id = _bill_line_receipt_station_id(line, bill)
                if not st_id:
                    st_id = get_or_create_default_station(company_id).id
                add_station_stock(company_id, st_id, item.id, qty)
    return applied_lines


def reverse_receipt_inventory_from_posted_bill(bill: Bill) -> None:
    """Undo receipt_inventory_from_posted_bill for current line rows (mirror receipt logic)."""
    from api.services.station_stock import add_station_stock, get_or_create_default_station, item_uses_station_bins

    company_id = bill.company_id
    for line in BillLine.objects.filter(bill_id=bill.id).select_related("item", "tank"):
        item = line.item
        if not item:
            continue
        qty = _bill_line_physical_receipt_quantity(line, item)
        if qty <= 0:
            continue
        if not _item_receives_physical_stock(item):
            continue
        tanks_qs = _tanks_for_stock_receipt(company_id, item)
        if tanks_qs.exists():
            tank = _pick_tank_for_bill_line(line, item, tanks_qs)
            if tank:
                Tank.objects.filter(pk=tank.pk).update(current_stock=F("current_stock") - qty)
                _sync_item_qoh_from_tanks(company_id, item.id)
        else:
            if not item_uses_station_bins(company_id, item):
                pond_id = getattr(line, "aquaculture_pond_id", None)
                if pond_id:
                    from api.services.aquaculture_pond_stock_service import add_pond_stock

                    add_pond_stock(company_id, int(pond_id), item.id, -qty)
                else:
                    st_id = _bill_line_receipt_station_id(line, bill)
                    if not st_id:
                        st_id = get_or_create_default_station(company_id).id
                    add_station_stock(company_id, st_id, item.id, -qty)
            else:
                st_id = _bill_line_receipt_station_id(line, bill)
                if not st_id:
                    st_id = get_or_create_default_station(company_id).id
                add_station_stock(company_id, st_id, item.id, -qty)


def undo_bill_stock_receipt(bill: Bill) -> None:
    """
    If stock was received for this bill, reverse tank/QOH movements and clear the flag.
    Call before replacing bill lines so a new receipt can be applied.
    """
    with transaction.atomic():
        locked = (
            Bill.objects.select_for_update()
            .filter(pk=bill.pk)
            .only("id", "stock_receipt_applied")
            .first()
        )
        if not locked or not locked.stock_receipt_applied:
            return
        reverse_receipt_inventory_from_posted_bill(bill)
        Bill.objects.filter(pk=bill.pk).update(stock_receipt_applied=False)


def try_apply_bill_stock_receipt(
    bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> None:
    """
    Apply inventory receipt once per bill (idempotent). Uses row lock so concurrent calls
    do not double-post stock.
    """
    with transaction.atomic():
        locked = (
            Bill.objects.select_for_update()
            .filter(pk=bill.pk)
            .only("id", "stock_receipt_applied")
            .first()
        )
        if not locked or locked.stock_receipt_applied:
            return
        n = receipt_inventory_from_posted_bill(
            bill, acknowledge_tank_overfill=acknowledge_tank_overfill
        )
        if n > 0:
            Bill.objects.filter(pk=bill.pk).update(stock_receipt_applied=True)


def _bill_line_receipt_station_id(line: BillLine, bill: Bill) -> Optional[int]:
    """Per-line station override, else bill header station."""
    lid = getattr(line, "receipt_station_id", None)
    if lid:
        return int(lid)
    bid = getattr(bill, "receipt_station_id", None)
    return int(bid) if bid else None


def _bill_line_fuel_station_meta(company_id: int, line: BillLine) -> Optional[dict]:
    """Maps optional bill line fuel-station category to journal reporting tags."""
    if getattr(line, "aquaculture_pond_id", None):
        return None
    trc_id = getattr(line, "tenant_reporting_category_id", None)
    code = (getattr(line, "fuel_station_expense_category", None) or "").strip()
    if not trc_id and not code:
        return None
    from api.services.tenant_reporting_categories import (
        FUEL_STATION_EXPENSE_MAP_CODES,
        fuel_station_reporting_category_for_journal,
    )

    meta: dict[str, Any] = {}
    if trc_id and fuel_station_reporting_category_for_journal(company_id, int(trc_id)):
        meta["tenant_reporting_category_id"] = int(trc_id)
    elif code in FUEL_STATION_EXPENSE_MAP_CODES:
        meta["fuel_station_expense_rollup"] = code
    elif code:
        meta["fuel_station_expense_rollup"] = code
    return meta or None


def _bill_line_aquaculture_meta(company_id: int, line: BillLine) -> Optional[dict]:
    """Maps optional bill line pond/cycle/bucket to journal line aquaculture costing (validated)."""
    if not getattr(line, "aquaculture_pond_id", None):
        return None
    pid = line.aquaculture_pond_id
    if not AquaculturePond.objects.filter(pk=pid, company_id=company_id).exists():
        return None
    meta: dict[str, Any] = {"pond_id": pid}
    cid = getattr(line, "aquaculture_production_cycle_id", None)
    if cid:
        cyc = AquacultureProductionCycle.objects.filter(
            pk=cid, company_id=company_id, pond_id=pid
        ).first()
        if cyc:
            meta["production_cycle_id"] = cid
    bucket = (getattr(line, "aquaculture_cost_bucket", None) or "").strip()
    item = getattr(line, "item", None)
    if not bucket and item:
        bucket = item_shop_issue_cost_bucket(item)
    if not bucket:
        bucket = "equipment"
    meta["cost_bucket"] = bucket[:40]
    trc_id = getattr(line, "tenant_reporting_category_id", None)
    if trc_id:
        meta["tenant_reporting_category_id"] = int(trc_id)
    return meta


_EXP_DEBIT_TYPES = frozenset({"expense", "cost_of_goods_sold"})


def _bill_line_expense_debit_account(
    company_id: int,
    line: BillLine,
    item: Optional[Item],
    vendor: Optional[Vendor],
    office_exp: ChartOfAccount,
) -> ChartOfAccount:
    """Non-inventory bill debits: line override, fuel-station rollup COA, item default, vendor default, else office expense."""
    lid = getattr(line, "expense_account_id", None)
    if lid:
        acc = ChartOfAccount.objects.filter(pk=lid, company_id=company_id, is_active=True).first()
        if acc and normalize_chart_account_type(acc.account_type) in _EXP_DEBIT_TYPES:
            return acc
    if not getattr(line, "aquaculture_pond_id", None):
        fs_cat = (getattr(line, "fuel_station_expense_category", None) or "").strip()
        if fs_cat or getattr(line, "tenant_reporting_category_id", None):
            from api.services.fuel_station_coa_constants import (
                chart_account_id_for_fuel_station_expense_rollup,
            )

            lookup = fs_cat
            if not lookup and getattr(line, "tenant_reporting_category_id", None):
                trc = getattr(line, "tenant_reporting_category", None)
                if trc is not None:
                    lookup = (getattr(trc, "code", None) or "").strip()
            if lookup:
                aid = chart_account_id_for_fuel_station_expense_rollup(company_id, lookup)
                if aid:
                    acc = ChartOfAccount.objects.filter(
                        pk=aid, company_id=company_id, is_active=True
                    ).first()
                    if acc and normalize_chart_account_type(acc.account_type) in _EXP_DEBIT_TYPES:
                        return acc
    if item and not _item_receives_physical_stock(item):
        iid = getattr(item, "expense_account_id", None)
        if iid:
            acc = ChartOfAccount.objects.filter(pk=iid, company_id=company_id, is_active=True).first()
            if acc and normalize_chart_account_type(acc.account_type) in _EXP_DEBIT_TYPES:
                return acc
    if vendor and getattr(vendor, "default_expense_account_id", None):
        vid = vendor.default_expense_account_id
        acc = ChartOfAccount.objects.filter(pk=vid, company_id=company_id, is_active=True).first()
        if acc and normalize_chart_account_type(acc.account_type) in _EXP_DEBIT_TYPES:
            return acc
    return office_exp


def _build_bill_journal_lines(
    company_id: int, bill: Bill
) -> Optional[tuple[list[tuple], list[Optional[dict]]]]:
    """
    Build balanced GL lines for a vendor bill (one debit row per bill line when possible).
    Inventory lines debit inventory accounts; other lines debit office expense. Remainder (e.g. tax)
    debits office expense. Optional aquaculture pond/cycle/bucket on each BillLine tags matching debit lines.

    Returns (lines, aquaculture_line_costing) for _create_posted_entry.
    """
    ap = _coa(company_id, CODE_AP)
    exp = _coa(company_id, ErpCoaCode.STATION_OPERATING) or _coa(company_id, CODE_OFFICE_EXP) or ChartOfAccount.objects.filter(
        company_id=company_id, account_type="expense", is_active=True
    ).first()
    if not ap or not exp:
        return None

    total = bill.total if bill.total is not None else Decimal("0")
    if total <= 0:
        return None

    memo_ap = (bill.bill_number or "")[:300]
    debit_rows: list[tuple[ChartOfAccount, Decimal, str, Optional[dict]]] = []

    vendor = Vendor.objects.filter(pk=bill.vendor_id).first() if bill.vendor_id else None

    lines_qs = BillLine.objects.filter(bill_id=bill.id).select_related(
        "item",
        "aquaculture_pond",
        "aquaculture_production_cycle",
        "expense_account",
        "tenant_reporting_category",
    )
    for line in lines_qs:
        amt = line.amount if line.amount is not None else Decimal("0")
        if amt <= 0:
            continue
        meta = _bill_line_aquaculture_meta(company_id, line) or _bill_line_fuel_station_meta(
            company_id, line
        )
        line_st = _gl_station_id(company_id, _bill_line_receipt_station_id(line, bill))
        desc_base = (line.description or "").strip()
        memo = (
            f"{bill.bill_number} — {desc_base}"[:300] if desc_base else (bill.bill_number or "")[:300]
        )
        item = line.item
        if not item:
            debit_acc = _bill_line_expense_debit_account(company_id, line, None, vendor, exp)
            debit_rows.append((debit_acc, amt, memo, meta, line_st))
            continue
        if _item_receives_physical_stock(item):
            inv_acc = _inventory_account_for_item(company_id, item)
            if inv_acc:
                debit_rows.append((inv_acc, amt, memo, meta, line_st))
            else:
                debit_acc = _bill_line_expense_debit_account(company_id, line, item, vendor, exp)
                debit_rows.append((debit_acc, amt, memo, meta, line_st))
        else:
            debit_acc = _bill_line_expense_debit_account(company_id, line, item, vendor, exp)
            debit_rows.append((debit_acc, amt, memo, meta, line_st))

    sum_lines = sum(am for row in debit_rows if (am := row[1]) > 0)
    if sum_lines < total:
        hdr_st = _gl_station_id(company_id, bill.receipt_station_id)
        debit_rows.append((exp, (total - sum_lines).quantize(Decimal("0.01")), memo_ap, None, hdr_st))
        sum_lines = total
    elif sum_lines > total:
        positive_rows = [row for row in debit_rows if row[1] > 0]
        if not positive_rows:
            logger.warning("bill %s: no positive line amounts to scale", bill.id)
            return None
        S = sum(row[1] for row in positive_rows)
        factor = total / S
        scaled: list[tuple] = []
        run = Decimal("0")
        for j, row in enumerate(positive_rows):
            acc, amt, desc, meta, line_st = row
            if j == len(positive_rows) - 1:
                na = (total - run).quantize(Decimal("0.01"))
            else:
                na = (amt * factor).quantize(Decimal("0.01"))
            scaled.append((acc, na, desc, meta, line_st))
            run += na
        debit_rows = scaled
        sum_lines = sum(row[1] for row in debit_rows)

    if sum_lines != total:
        diff = (total - sum_lines).quantize(Decimal("0.01"))
        if debit_rows and abs(diff) <= Decimal("0.02"):
            acc, am, ds, mt, line_st = debit_rows[-1]
            debit_rows[-1] = (acc, (am + diff).quantize(Decimal("0.01")), ds, mt, line_st)
        else:
            logger.warning(
                "skip bill %s journal: debit sum %s != total %s",
                bill.id,
                sum_lines,
                total,
            )
            return None

    if not debit_rows:
        hdr_st = _gl_station_id(company_id, bill.receipt_station_id)
        debit_rows = [(exp, total, memo_ap, None, hdr_st)]

    je_lines: list[tuple] = []
    aq_costing: list[Optional[dict]] = []
    for acc, amt, desc, meta, line_st in debit_rows:
        if amt <= 0:
            continue
        je_lines.append((acc, amt, Decimal("0"), desc, line_st))
        aq_costing.append(meta)

    # Pond-as-entity completeness: when every costed debit line of this bill belongs to the SAME
    # pond, tag the A/P credit to that pond too, so the pond balance sheet carries the matching
    # liability (otherwise the pond shows the asset/expense but not the payable). Mixed-pond or
    # partially-tagged bills leave A/P untagged (company-level liability).
    ap_meta: Optional[dict] = None
    costed = [m for m in aq_costing if m and m.get("pond_id")]
    if costed and len(costed) == len(aq_costing):
        pond_ids = {m.get("pond_id") for m in costed}
        if len(pond_ids) == 1:
            only = costed[0]
            ap_meta = {"pond_id": only.get("pond_id")}
            if only.get("production_cycle_id"):
                ap_meta["production_cycle_id"] = only.get("production_cycle_id")
    je_lines.append((ap, Decimal("0"), total, memo_ap))
    aq_costing.append(ap_meta)

    td = sum(_unpack_gl_line(x)[1] for x in je_lines)
    tc = sum(_unpack_gl_line(x)[2] for x in je_lines)
    if td != tc or td <= 0:
        logger.warning(
            "skip bill %s journal: unbalanced (debit=%s credit=%s)",
            bill.id,
            td,
            tc,
        )
        return None
    return (je_lines, aq_costing)


def bill_eligible_for_posting(bill: Optional[Bill]) -> bool:
    """
    Posted vendor bills that should drive GL (when COA allows), vendor A/P, and inventory/tanks.
    Draft, void, non-positive totals, or unknown statuses are excluded.
    """
    if not bill:
        return False
    total = bill.total if bill.total is not None else Decimal("0")
    if total <= 0:
        return False
    st = (bill.status or "").strip().lower()
    return st in ("open", "paid", "partial", "overdue")


def _ensure_vendor_ap_for_posted_bill(company_id: int, bill: Bill) -> None:
    """
    Add bill total to vendor.current_balance once (idempotent via vendor_ap_incremented).
    Runs for every posted bill so A/P stays in sync even when AUTO-BILL GL entry cannot be built.
    """
    with transaction.atomic():
        b = Bill.objects.select_for_update().filter(pk=bill.pk, company_id=company_id).first()
        if not b or not bill_eligible_for_posting(b):
            return
        if not b.vendor_id or b.vendor_ap_incremented:
            return
        amt = b.total if b.total is not None else Decimal("0")
        if amt <= 0:
            return
        Vendor.objects.filter(pk=b.vendor_id).update(current_balance=F("current_balance") + amt)
        Bill.objects.filter(pk=b.pk).update(vendor_ap_incremented=True)


def cleanup_vendor_bill_posting_effects(company_id: int, bill: Bill) -> None:
    """
    Before deleting a bill: reverse tank/item receipt, remove AUTO-BILL journal, roll back vendor A/P bump.
    Caller must ensure no payment allocations remain on the bill.
    """
    with transaction.atomic():
        b = Bill.objects.select_for_update().filter(pk=bill.pk, company_id=company_id).first()
        if not b:
            return
        undo_bill_stock_receipt(b)
        b.refresh_from_db(fields=["vendor_ap_incremented", "vendor_id", "total"])
        if b.vendor_ap_incremented and b.vendor_id:
            amt = b.total if b.total is not None else Decimal("0")
            if amt > 0:
                Vendor.objects.filter(pk=b.vendor_id).update(
                    current_balance=F("current_balance") - amt
                )
            Bill.objects.filter(pk=b.pk).update(vendor_ap_incremented=False)
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-BILL-{b.id}"
        ).delete()


def _invoice_unrecord_shift_params(company_id: int, inv: Invoice) -> tuple[Decimal, str, Decimal | None]:
    """
    Mirror record_invoice_on_shift / cashier_pos: split-tender invoices store payment_method ``mixed``,
    but shift cash used the tender type(s) of the immediate payment row(s).
    """
    total = inv.total if inv.total is not None else Decimal("0")
    pm = (inv.payment_method or "").strip().lower()
    if pm != "mixed":
        return total, pm, None
    cash_part = Decimal("0")
    for alloc in PaymentInvoiceAllocation.objects.filter(invoice_id=inv.id).select_related("payment"):
        p = alloc.payment
        if (p.payment_method or "").strip().lower() == "cash":
            cash_part += alloc.amount if alloc.amount is not None else Decimal("0")
    if cash_part > 0:
        return total, "cash", cash_part
    return total, "card", None


def rollback_invoice_posting_effects(
    company_id: int,
    inv: Invoice,
    *,
    purge_linked_payments: bool = False,
) -> tuple[bool, str]:
    """
    Reverse invoice GL (AUTO-INV-*), POS/shift totals, and fuel/POS stock effects.

    When ``purge_linked_payments`` is True (delete), linked customer receipts are reversed and removed
    unless blocked by bank deposit or multi-invoice allocation. When False (material edit), payments
    are left in place; callers must still pass ``assert_invoice_change_allowed`` first.
    """
    inv_id = int(inv.id)
    action = "delete" if purge_linked_payments else "change"
    with transaction.atomic():
        locked = (
            Invoice.objects.select_for_update()
            .filter(pk=inv_id, company_id=company_id)
            .select_related("customer")
            .first()
        )
        if not locked:
            return True, ""

        alloc_rows = list(
            PaymentInvoiceAllocation.objects.filter(
                invoice_id=inv_id, payment__company_id=company_id
            ).select_related("payment")
        )
        pay_by_id: dict[int, Payment] = {}
        for a in alloc_rows:
            pay_by_id[a.payment_id] = a.payment

        for p in pay_by_id.values():
            if getattr(p, "bank_deposit_id", None):
                return (
                    False,
                    f"Cannot {action} this invoice: a linked customer receipt was included in a bank deposit. "
                    "Remove that receipt from the deposit first.",
                )
            other = PaymentInvoiceAllocation.objects.filter(payment_id=p.id).exclude(invoice_id=inv_id)
            if other.exists():
                return (
                    False,
                    f"Cannot {action} this invoice while customer payments are applied to other invoices. "
                    "Remove or reallocate those payments in Payments first.",
                )

        is_pos_invoice = (locked.invoice_number or "").strip().upper().startswith("INV-POS-")
        if is_pos_invoice:
            total, shift_pm, shift_cash_tender = _invoice_unrecord_shift_params(company_id, locked)
            unrecord_invoice_from_shift(
                company_id,
                locked.shift_session_id,
                total,
                shift_pm,
                cash_tender_amount=shift_cash_tender,
            )

        if purge_linked_payments:
            for p in sorted(pay_by_id.values(), key=lambda x: x.id):
                ok_rev, rerr = reverse_payment_received_posting(company_id, p)
                if not ok_rev:
                    return (
                        False,
                        (rerr or "Could not reverse a linked payment").strip()
                        + " Remove the payment in Payments before deleting this invoice.",
                    )
                p.delete()

        for line in (
            InvoiceLine.objects.filter(invoice_id=inv_id)
            .select_related("nozzle", "nozzle__meter", "nozzle__tank", "item")
        ):
            nz = line.nozzle
            qty = line.quantity if line.quantity is not None else Decimal("0")
            if qty <= 0:
                continue
            if nz is not None:
                m = nz.meter
                t = nz.tank
                if m is not None:
                    Meter.objects.filter(pk=m.pk).update(
                        current_reading=F("current_reading") - qty
                    )
                if t is not None:
                    Tank.objects.filter(pk=t.pk).update(
                        current_stock=F("current_stock") + qty
                    )
                continue
            it = line.item
            st_id = locked.station_id
            if it is None or st_id is None or not is_pos_invoice:
                continue
            if item_uses_station_bins(company_id, it):
                add_station_stock(company_id, int(st_id), int(it.id), qty)
            elif (
                item_tracks_physical_stock(it)
                and _item_receives_physical_stock(it)
                and it.quantity_on_hand is not None
            ):
                Item.objects.filter(pk=it.pk, company_id=company_id).update(
                    quantity_on_hand=F("quantity_on_hand") + qty
                )

        used_ar = invoice_sale_used_ar(company_id, inv_id)
        cust = locked.customer
        walkin = _is_walkin_customer(cust) if cust else True

        rcpt = (
            JournalEntry.objects.filter(
                company_id=company_id, entry_number=f"AUTO-INV-{inv_id}-RCPT"
            )
            .prefetch_related("lines")
            .first()
        )
        if rcpt and locked.customer_id and not walkin:
            ar = _coa(company_id, CODE_AR)
            if ar:
                ar_credit = Decimal("0")
                for ln in rcpt.lines.all():
                    if ln.account_id == ar.id:
                        ar_credit += ln.credit if ln.credit is not None else Decimal("0")
                if ar_credit > 0:
                    Customer.objects.filter(pk=locked.customer_id).update(
                        current_balance=F("current_balance") + ar_credit
                    )
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-INV-{inv_id}-RCPT"
        ).delete()

        inv_total = locked.total if locked.total is not None else Decimal("0")
        if used_ar and locked.customer_id and not walkin and inv_total > 0:
            Customer.objects.filter(pk=locked.customer_id).update(
                current_balance=F("current_balance") - inv_total
            )

        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-INV-{inv_id}-COGS"
        ).delete()
        JournalEntry.objects.filter(
            company_id=company_id, entry_number=f"AUTO-INV-{inv_id}-SALE"
        ).delete()

    return True, ""


def cleanup_invoice_posting_effects(company_id: int, inv: Invoice) -> tuple[bool, str]:
    """
    Before deleting an invoice (manual or POS): full rollback including linked payments when safe.
    Aquaculture pond sales use the same AUTO-INV journals; pond inventory expenses use
    ``cleanup_aquaculture_expense_posting_effects``.
    """
    return rollback_invoice_posting_effects(company_id, inv, purge_linked_payments=True)


def sync_posted_vendor_bill(
    company_id: int, bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> bool:
    """
    Single integration point: reload bill from DB, then GL (if possible), vendor A/P, and inventory/tanks.
    """
    fresh = Bill.objects.filter(pk=bill.pk, company_id=company_id).first()
    if not fresh:
        return False
    return post_bill_journal(
        company_id, fresh, acknowledge_tank_overfill=acknowledge_tank_overfill
    )


def post_bill_journal(
    company_id: int, bill: Bill, *, acknowledge_tank_overfill: bool = False
) -> bool:
    """
    Post vendor bill: AUTO-BILL-{id} when chart of accounts allows; always (when posted) vendor A/P
    and one-time inventory/tank receipt for qualifying lines.
    """
    bill = Bill.objects.filter(pk=bill.pk, company_id=company_id).first()
    if not bill or not bill_eligible_for_posting(bill):
        return False
    entry_number = f"AUTO-BILL-{bill.id}"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        _ensure_vendor_ap_for_posted_bill(company_id, bill)
        try:
            try_apply_bill_stock_receipt(
                bill, acknowledge_tank_overfill=acknowledge_tank_overfill
            )
        except StockBusinessError:
            raise
        except Exception:
            logger.exception(
                "try_apply_bill_stock_receipt failed for bill %s (journal already exists)",
                bill.id,
            )
        return True

    validate_bill_entity_tags_for_gl(company_id, bill)

    built = _build_bill_journal_lines(company_id, bill)
    je = None
    if built:
        lines, aq_cost = built
        bst = _gl_station_id(company_id, bill.receipt_station_id)
        je = _create_posted_entry(
            company_id,
            bill.bill_date,
            entry_number,
            f"Bill {bill.bill_number}",
            lines,
            gl_station_id=bst,
            aquaculture_line_costing=aq_cost,
        )

    _ensure_vendor_ap_for_posted_bill(company_id, bill)

    try:
        try_apply_bill_stock_receipt(
            bill, acknowledge_tank_overfill=acknowledge_tank_overfill
        )
    except StockBusinessError:
        raise
    except Exception:
        logger.exception(
            "try_apply_bill_stock_receipt failed for bill %s (after journal attempt)",
            bill.id,
        )
    return je is not None


def resync_posted_bill_journal_from_lines(company_id: int, bill_id: int) -> bool:
    """
    Refresh an existing AUTO-BILL journal after bill line reporting metadata or expense accounts change.
    Updates debit lines in order; leaves amounts and the A/P credit line unchanged.
    """
    from api.models import Bill, JournalEntry, JournalEntryLine

    bill = Bill.objects.filter(pk=bill_id, company_id=company_id).first()
    if not bill or not bill_eligible_for_posting(bill):
        return False
    entry_number = f"AUTO-BILL-{bill.id}"
    je = JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).first()
    if not je:
        return False
    built = _build_bill_journal_lines(company_id, bill)
    if not built:
        return False
    lines, aq_cost = built
    debit_specs: list[tuple] = []
    meta_specs: list[Optional[dict]] = []
    for raw, meta in zip(lines, aq_cost):
        acc, debit, credit, desc, st_opt, explicit = _unpack_gl_line(raw)
        if debit <= 0:
            continue
        debit_specs.append((acc, debit, desc, st_opt, explicit))
        meta_specs.append(meta)

    existing = list(
        JournalEntryLine.objects.filter(journal_entry_id=je.id, debit__gt=0).order_by("id")
    )
    if len(existing) != len(debit_specs):
        logger.warning(
            "skip resync bill %s journal: line count mismatch (%s vs %s)",
            bill.id,
            len(existing),
            len(debit_specs),
        )
        if not existing or not debit_specs:
            return False
        # Partial refresh: update the overlapping debit lines in order.
        existing = existing[: len(debit_specs)]

    for jl, (acc, _amt, desc, st_opt, explicit), meta in zip(existing, debit_specs, meta_specs):
        hdr = _gl_station_id(company_id, bill.receipt_station_id)
        if explicit:
            line_st = _gl_station_id(company_id, st_opt) if st_opt is not None else None
        else:
            line_st = hdr
        aq_kw = _journal_line_bill_meta_kwargs(company_id, meta)
        updates: dict[str, Any] = {
            "account_id": acc.id,
            "description": desc[:300],
            "station_id": line_st,
            **aq_kw,
        }
        JournalEntryLine.objects.filter(pk=jl.pk).update(**updates)
    return True


def post_fund_transfer_journal(company_id: int, ft: FundTransfer) -> bool:
    """Dr destination bank GL, Cr source bank GL. AUTO-FT-{id}."""
    if not ft.is_posted:
        return False
    entry_number = f"AUTO-FT-{ft.id}"
    if JournalEntry.objects.filter(
        company_id=company_id, entry_number=entry_number
    ).exists():
        return True
    from_acc = (
        ft.from_bank.chart_account
        if ft.from_bank and ft.from_bank.chart_account_id
        else None
    )
    to_acc = (
        ft.to_bank.chart_account
        if ft.to_bank and ft.to_bank.chart_account_id
        else None
    )
    if not from_acc or not to_acc:
        return False
    amt = ft.amount
    lines = [
        (to_acc, amt, Decimal("0"), ft.reference or f"FT-{ft.id}"),
        (from_acc, Decimal("0"), amt, ft.reference or f"FT-{ft.id}"),
    ]
    return (
        _create_posted_entry(
            company_id,
            ft.transfer_date,
            entry_number,
            f"Fund transfer #{ft.id}",
            lines,
        )
        is not None
    )


def sync_invoice_gl(
    company_id: int,
    inv: Invoice,
    *,
    old_status: Optional[str] = None,
    payment_method: str = "cash",
    bank_account_id: Optional[int] = None,
) -> None:
    """Create posted journals for invoice lifecycle (sale + optional AR receipt)."""
    inv.refresh_from_db()
    post_invoice_sale_journal(
        company_id,
        inv,
        payment_method=payment_method,
        bank_account_id=bank_account_id,
    )
    post_invoice_cogs_journal(company_id, inv)
    if (
        old_status
        and old_status != "paid"
        and inv.status == "paid"
        and invoice_sale_used_ar(company_id, inv.id)
    ):
        post_invoice_receipt_journal(
            company_id,
            inv,
            payment_method=payment_method,
            bank_account_id=bank_account_id,
        )


def _payment_received_clearing_buckets(
    company_id: int, payment_id: int
) -> Optional[dict[int, tuple[ChartOfAccount, Decimal]]]:
    """Debit-side lines from AUTO-PAY-{id}-RCV (cash / undeposited / card clearing), keyed by chart account id."""
    en = f"AUTO-PAY-{payment_id}-RCV"
    je = (
        JournalEntry.objects.filter(company_id=company_id, entry_number=en)
        .prefetch_related("lines__account")
        .first()
    )
    if not je:
        return None
    buckets: dict[int, tuple[ChartOfAccount, Decimal]] = {}
    for ln in je.lines.all():
        d = ln.debit or Decimal("0")
        if d <= 0:
            continue
        aid = ln.account_id
        acc = ln.account
        if aid not in buckets:
            buckets[aid] = (acc, Decimal("0"))
        a0, s0 = buckets[aid]
        buckets[aid] = (a0, s0 + d)
    return buckets if buckets else None


def post_bank_deposit_journal(
    company_id: int,
    deposit_id: int,
    dest_bank: BankAccount,
    payments: list[Payment],
    deposit_date: date,
    memo: str,
) -> bool:
    """
    Move funds from receipt clearing accounts into the destination bank GL account.

    Dr Bank (register's chart account), Cr clearing account(s) from each payment's
    AUTO-PAY-*-RCV journal. Idempotent: AUTO-DEP-{deposit_id}.
    """
    if not payments:
        return False
    entry_number = f"AUTO-DEP-{deposit_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=entry_number).exists():
        return True
    dest = dest_bank.chart_account
    if not dest:
        logger.warning(
            "post_bank_deposit_journal: bank account %s has no linked chart account",
            dest_bank.id,
        )
        return False

    credits: dict[int, tuple[ChartOfAccount, Decimal]] = {}
    total_dr = Decimal("0")
    for p in payments:
        buckets = _payment_received_clearing_buckets(company_id, p.id)
        if not buckets:
            logger.warning(
                "post_bank_deposit_journal: missing AUTO-PAY-%s-RCV for payment %s",
                p.id,
                p.id,
            )
            return False
        pay_amt = (p.amount or Decimal("0")).quantize(Decimal("0.01"))
        if pay_amt <= 0:
            return False
        je_total = sum(s for _, s in buckets.values())
        if je_total <= 0:
            return False
        scale = pay_amt / je_total
        for aid, (acc, dsum) in buckets.items():
            part = (dsum * scale).quantize(Decimal("0.01"))
            if aid not in credits:
                credits[aid] = (acc, Decimal("0"))
            a0, s0 = credits[aid]
            credits[aid] = (a0, s0 + part)
        total_dr += pay_amt

    line_desc = (memo or f"Bank deposit #{deposit_id}")[:300]
    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = [
        (dest, total_dr, Decimal("0"), line_desc)
    ]
    credit_sum = Decimal("0")
    for acc, camt in credits.values():
        camt = camt.quantize(Decimal("0.01"))
        lines.append((acc, Decimal("0"), camt, line_desc))
        credit_sum += camt

    if abs(credit_sum - total_dr) > Decimal("0.05"):
        logger.warning(
            "post_bank_deposit_journal: credits %s != debits %s for deposit %s",
            credit_sum,
            total_dr,
            deposit_id,
        )
        return False

    je = _create_posted_entry(
        company_id,
        deposit_date,
        entry_number,
        f"Bank deposit #{deposit_id}",
        lines,
    )
    return je is not None


def _payroll_deduction_credit_account(company_id: int) -> Optional[ChartOfAccount]:
    """Statutory or generic payroll liability for withheld amounts."""
    a = _coa(company_id, CODE_STAT_DED)
    if a:
        return a
    return _coa(company_id, CODE_SALARY_PAYABLE)


def _payroll_net_pay_credit_account(
    company_id: int,
    bank_account_id: Optional[int],
    pay_from_chart_account_id: Optional[int],
) -> tuple[Optional[ChartOfAccount], Optional[str]]:
    """
    GL account to credit for net pay. Bank register wins if both are sent.
    """
    if bank_account_id:
        bank = (
            BankAccount.objects.filter(
                id=bank_account_id, company_id=company_id, is_active=True
            )
            .select_related("chart_account")
            .first()
        )
        if not bank or not bank.chart_account_id:
            return None, (
                "Bank account is missing or not linked to a chart of accounts line. "
                "Link it in Banking, or pick a bank/cash GL account below."
            )
        return bank.chart_account, None

    if pay_from_chart_account_id:
        coa = (
            ChartOfAccount.objects.filter(
                id=pay_from_chart_account_id,
                company_id=company_id,
                is_active=True,
            )
            .first()
        )
        if not coa:
            return None, "Selected GL account was not found or is inactive."
        t = normalize_chart_account_type(coa.account_type)
        if t not in ("asset", "bank_account"):
            return None, (
                "Net pay must be credited to a bank or cash asset account "
                f"(e.g. {CODE_BANK_OP} or {CODE_CASH}). "
                f"Account {coa.account_code} is not valid for net pay; salary expense still uses {CODE_SALARY_EXP}."
            )
        return coa, None

    pay = _coa(company_id, CODE_BANK_OP) or _coa(company_id, CODE_CASH)
    if not pay:
        return None, f"Add chart {CODE_BANK_OP} / {CODE_CASH} or select a register / GL account above for net pay."
    return pay, None


def post_payroll_salary(
    company_id: int,
    pr: PayrollRun,
    bank_account_id: Optional[int] = None,
    pay_from_chart_account_id: Optional[int] = None,
):
    """
    Book net salary paid from a bank (or default cash/bank account).

    Dr 6400 (Salaries & Wages) = gross
    Cr 2210/2200 = total_deductions (when > 0)
    Cr selected bank register, chosen GL account, or default 1030/1010 = net pay to employees

    If both bank_account_id and pay_from_chart_account_id are provided, the bank register is used.
    Idempotent entry: AUTO-PAYROLL-{id}. Returns (JournalEntry|None, error message).

    Also syncs per-employee HR subledger lines (linked to this payroll run) when totals
    can be allocated across active employees with positive salary.
    """
    pr = PayrollRun.objects.filter(id=pr.id, company_id=company_id).first()
    if not pr:
        return None, "Payroll run not found"
    if pr.salary_journal_id:
        sync_payroll_run_to_employee_ledgers(company_id, pr)
        return pr.salary_journal, ""

    gross = (pr.total_gross or Decimal("0")).quantize(Decimal("0.01"))
    ded = (pr.total_deductions or Decimal("0")).quantize(Decimal("0.01"))
    net = (pr.total_net or Decimal("0")).quantize(Decimal("0.01"))
    if gross <= 0:
        return None, "Set payroll totals first (gross must be positive)."
    if abs(gross - ded - net) > Decimal("0.02"):
        return (
            None,
            f"Gross ({gross}) must equal deductions ({ded}) + net pay ({net})",
        )

    from api.services.employee_pond_labor import ensure_payroll_pond_allocations_before_post
    from api.services.station_defaults import default_payroll_station_id
    from api.services.station_stock import get_or_create_default_station

    _, pond_alloc_err = ensure_payroll_pond_allocations_before_post(company_id, pr)
    if pond_alloc_err:
        return None, pond_alloc_err
    from api.models import PayrollRunEmployeeAllocation
    from api.services.employee_payroll_allocations import (
        employee_allocation_sum,
        sync_payroll_employee_allocations_from_hr,
        validate_employee_allocations_match_gross,
    )

    stored_count = PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).count()
    if stored_count == 0:
        sync_payroll_employee_allocations_from_hr(company_id, pr)
        stored_count = PayrollRunEmployeeAllocation.objects.filter(payroll_run_id=pr.id).count()

    alloc_sum = employee_allocation_sum(pr.id)
    match_err = validate_employee_allocations_match_gross(
        gross, alloc_sum, require_rows=True, row_count=stored_count
    )
    if match_err:
        return None, match_err
    pr = PayrollRun.objects.filter(id=pr.id, company_id=company_id).first()
    if not pr:
        return None, "Payroll run not found"

    expense = None
    if getattr(pr, "salary_expense_account_id", None):
        expense = ChartOfAccount.objects.filter(
            pk=pr.salary_expense_account_id, company_id=company_id, is_active=True
        ).first()
        if expense and normalize_chart_account_type(expense.account_type) != "expense":
            expense = None
    pond_alloc_rows = list(
        PayrollRunPondAllocation.objects.filter(payroll_run_id=pr.id)
        .select_related("pond")
        .order_by("pond_id")
    )
    alloc_gross = Decimal("0")
    for row in pond_alloc_rows:
        amt = row.amount
        if amt is None:
            continue
        if not isinstance(amt, Decimal):
            amt = Decimal(str(amt))
        alloc_gross += amt
    alloc_gross = alloc_gross.quantize(Decimal("0.01"))
    company_gross = max(gross - alloc_gross, Decimal("0")).quantize(Decimal("0.01"))
    split_by_pond = bool(pond_alloc_rows) and alloc_gross > 0
    if split_by_pond and alloc_gross > gross + Decimal("0.02"):
        return None, f"Pond allocations ({alloc_gross}) exceed payroll gross ({gross})."
    split_mixed_entities = split_by_pond and company_gross > Decimal("0.02")
    split_full_pond = split_by_pond and not split_mixed_entities and abs(alloc_gross - gross) <= Decimal("0.02")

    if not split_full_pond and not _gl_station_id(company_id, pr.station_id):
        default_sid = default_payroll_station_id(company_id)
        if not default_sid:
            default_sid = get_or_create_default_station(company_id).id
        if default_sid:
            PayrollRun.objects.filter(pk=pr.pk).update(station_id=default_sid)
            pr.refresh_from_db()

    try:
        validate_payroll_entity_tags_for_gl(
            company_id,
            pr,
            split_by_pond=split_by_pond,
            split_mixed_entities=split_mixed_entities,
        )
    except GlPostingError as ex:
        return None, ex.detail

    pond_exp = _coa(company_id, CODE_AQUACULTURE_LABOR_EXP)
    company_exp = _coa(company_id, CODE_SALARY_EXP)
    if split_by_pond and not pond_exp:
        return None, f"Add chart account {CODE_AQUACULTURE_LABOR_EXP} (pond labor) for aquaculture wage splits."

    if split_full_pond and not getattr(pr, "salary_expense_account_id", None) and pond_exp:
        expense = pond_exp
    elif not expense:
        expense = company_exp or pond_exp
    if not expense and not split_by_pond:
        return None, f"Add chart account {CODE_SALARY_EXP} (Salaries & Wages) or pick a salary expense account."
    if split_mixed_entities and not company_exp:
        return None, f"Add chart account {CODE_SALARY_EXP} for site / company payroll (non-pond wages)."

    pay_account, pay_err = _payroll_net_pay_credit_account(
        company_id, bank_account_id, pay_from_chart_account_id
    )
    if pay_err or not pay_account:
        return None, pay_err or "Could not resolve account for net pay"

    if ded > 0 and not _payroll_deduction_credit_account(company_id):
        return None, f"For deductions, add {CODE_STAT_DED} or {CODE_SALARY_PAYABLE} in the chart of accounts."

    ref = f"{pr.payroll_number or f'PR-{pr.id}'}"[:300]
    en = f"AUTO-PAYROLL-{pr.id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        je = JournalEntry.objects.filter(company_id=company_id, entry_number=en).first()
        if je and not pr.salary_journal_id:
            PayrollRun.objects.filter(pk=pr.pk).update(salary_journal=je, status="paid")
        sync_payroll_run_to_employee_ledgers(company_id, pr)
        return je, ""

    lines: list[tuple[ChartOfAccount, Decimal, Decimal, str]] = []
    aq_costing: list[Optional[dict]] = []
    pr_st = _gl_station_id(company_id, pr.station_id)
    if split_by_pond:
        pond_debit_account = pond_exp or expense
        for row in pond_alloc_rows:
            amt = (row.amount or Decimal("0")).quantize(Decimal("0.01"))
            if amt <= 0:
                continue
            pname = (row.pond.name if row.pond else "").strip() or f"Pond #{row.pond_id}"
            lines.append(
                (pond_debit_account, amt, Decimal("0"), f"Pond labor — {pname} — {ref}", None),
            )
            aq_costing.append(
                {"pond_id": row.pond_id, "cost_bucket": "worker_salary"},
            )
        if split_mixed_entities:
            site_exp = company_exp or expense
            if not site_exp:
                return None, f"Add chart account {CODE_SALARY_EXP} for site / company payroll."
            lines.append(
                (site_exp, company_gross, Decimal("0"), f"Site / company payroll — {ref}", pr_st),
            )
            aq_costing.append(None)
    else:
        if not expense:
            return None, f"Add chart account {CODE_SALARY_EXP} (Salaries & Wages) or pick a salary expense account."
        lines.append((expense, gross, Decimal("0"), f"Gross pay — {ref}", pr_st))
        aq_costing.append(None)

    if ded > 0:
        dacc = _payroll_deduction_credit_account(company_id)
        if not dacc:
            return None, "Deductions account not configured"
        ded_st = pr_st if (not split_by_pond or split_mixed_entities) else None
        lines.append((dacc, Decimal("0"), ded, f"Deductions / withholdings — {ref}", ded_st))
        aq_costing.append(None)

    if not split_by_pond or split_mixed_entities:
        pay_line_st = pr_st
    else:
        pay_line_st = None
    lines.append((pay_account, Decimal("0"), net, f"Net pay — {ref}", pay_line_st))
    aq_costing.append(None)

    je = _create_posted_entry(
        company_id,
        pr.payment_date,
        en,
        f"Salary pay {pr.payroll_number or en}",
        lines,
        gl_station_id=pr_st if (not split_by_pond or split_mixed_entities) else None,
        aquaculture_line_costing=aq_costing if split_by_pond and pond_exp else None,
    )
    if not je:
        return None, "Failed to post journal (unbalanced or invalid)"
    with transaction.atomic():
        PayrollRun.objects.filter(pk=pr.pk).update(salary_journal=je, status="paid")
    pr = PayrollRun.objects.filter(pk=pr.pk).first()
    if pr:
        sync_payroll_run_to_employee_ledgers(company_id, pr)
    return je, ""


def release_payroll_salary_journal(
    company_id: int,
    *,
    journal_entry_id: int | None = None,
    entry_number: str | None = None,
) -> PayrollRun | None:
    """
    When an AUTO-PAYROLL salary journal is removed, revert the payroll run to draft,
    clear the salary_journal link, and remove HR subledger lines for that run.
    """
    import re

    pr: PayrollRun | None = None
    if journal_entry_id:
        pr = PayrollRun.objects.filter(
            company_id=company_id, salary_journal_id=journal_entry_id
        ).first()
    en = (entry_number or "").strip()
    if not pr and en:
        m = re.match(r"^AUTO-PAYROLL-(\d+)$", en)
        if m:
            pr = PayrollRun.objects.filter(
                company_id=company_id, pk=int(m.group(1))
            ).first()
    if not pr:
        return None

    pr_id = int(pr.pk)
    old_eids = set(
        EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).values_list(
            "employee_id", flat=True
        )
    )
    EmployeeLedgerEntry.objects.filter(payroll_run_id=pr_id).delete()
    for eid in old_eids:
        refresh_employee_balance(int(eid))

    PayrollRun.objects.filter(pk=pr_id).update(salary_journal=None, status="draft")
    return PayrollRun.objects.filter(pk=pr_id).first()


_POSTED_PAYROLL_STATUSES = frozenset({"paid", "processed"})


def reconcile_payroll_run_gl_state(company_id: int, pr: PayrollRun) -> PayrollRun:
    """
    Keep payroll.status aligned with salary_journal_id.
    A run is posted to the GL only when its salary journal row still exists.
    """
    jid = pr.salary_journal_id
    status = (pr.status or "draft").strip().lower()

    if jid and not JournalEntry.objects.filter(pk=jid, company_id=company_id).exists():
        fixed = release_payroll_salary_journal(
            company_id,
            entry_number=f"AUTO-PAYROLL-{pr.id}",
        )
        return fixed or pr

    if not jid and status in _POSTED_PAYROLL_STATUSES:
        fixed = release_payroll_salary_journal(
            company_id,
            entry_number=f"AUTO-PAYROLL-{pr.id}",
        )
        return fixed or pr

    return pr


def reconcile_company_payroll_gl_states(company_id: int) -> int:
    """Bulk-fix payroll runs marked paid/processed with no salary journal."""
    orphan_ids = list(
        PayrollRun.objects.filter(
            company_id=company_id,
            salary_journal_id__isnull=True,
            status__in=_POSTED_PAYROLL_STATUSES,
        ).values_list("id", flat=True)
    )
    for pid in orphan_ids:
        release_payroll_salary_journal(
            company_id, entry_number=f"AUTO-PAYROLL-{pid}"
        )
    return len(orphan_ids)


def post_inventory_transfer_journal(company_id: int, transfer_id: int) -> bool:
    """
    Inter-station stock move of shop inventory: Dr and Cr the same inventory GL account
    (e.g. 1220) with different line memos so the entry balances and total asset is unchanged;
    subledger is ItemStationStock. Idempotent: AUTO-ISTR-{id}.
    """
    from api.services.station_stock import item_uses_station_bins

    tr = (
        InventoryTransfer.objects.filter(pk=transfer_id, company_id=company_id)
        .select_related("from_station", "to_station")
        .first()
    )
    if not tr or tr.status != InventoryTransfer.STATUS_POSTED:
        return False
    en = f"AUTO-ISTR-{transfer_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        return True
    bucket: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    for line in (
        InventoryTransferLine.objects.filter(transfer_id=tr.id).select_related("item")
    ):
        it = line.item
        if not it or not item_uses_station_bins(company_id, it):
            continue
        cost = it.cost or Decimal("0")
        if cost <= 0:
            cost = it.unit_price or Decimal("0")
        if cost <= 0:
            continue
        qty = line.quantity or Decimal("0")
        if qty <= 0:
            continue
        a = (qty * cost).quantize(Decimal("0.01"))
        if a <= 0:
            continue
        acc = _inventory_account_for_item(company_id, it)
        if not acc:
            continue
        bucket[acc.id] += a
    if not bucket:
        return True
    from_name = (tr.from_station.station_name or f"ST-{tr.from_station_id}")[:120]
    to_name = (tr.to_station.station_name or f"ST-{tr.to_station_id}")[:120]
    memo_in = f"Inter-station transfer — in @ {to_name} (TR-{transfer_id})"[:300]
    memo_out = f"Inter-station transfer — out @ {from_name} (TR-{transfer_id})"[:300]
    desc = f"Inventory transfer {tr.transfer_number or tr.id} {from_name} → {to_name}"[:500]
    to_id = _gl_station_id(company_id, tr.to_station_id)
    from_id = _gl_station_id(company_id, tr.from_station_id)
    jlines: list[tuple] = []
    for acc_id, amt in sorted(bucket.items()):
        acc = ChartOfAccount.objects.filter(
            id=acc_id, company_id=company_id, is_active=True
        ).first()
        if not acc or amt <= 0:
            continue
        jlines.append((acc, amt, Decimal("0"), memo_in, to_id))
        jlines.append((acc, Decimal("0"), amt, memo_out, from_id))
    if not jlines:
        return True
    return (
        _create_posted_entry(company_id, tr.transfer_date, en, desc, jlines, gl_station_id=None)
        is not None
    )


def delete_auto_inventory_transfer_journal(company_id: int, transfer_id: int) -> int:
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id, entry_number=f"AUTO-ISTR-{transfer_id}"
    ).delete()
    return deleted


def delete_auto_inventory_adjustment_journal(company_id: int, adjustment_id: int) -> int:
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id, entry_number=f"AUTO-INVADJ-{adjustment_id}"
    ).delete()
    return deleted


def post_inventory_adjustment_journal(company_id: int, adjustment_id: int) -> bool:
    """
    Book a shop stock-count variance (the C-store analogue of the fuel tank-dip variance).

    Per inventory account, net the signed variance value (counted - book) x unit cost:
      - net gain  -> Dr inventory asset / Cr 5210 Inventory Shrinkage (single adjustment account)
      - net loss  -> Dr 5210 Inventory Shrinkage / Cr inventory asset
    5210 absorbs both directions so it nets to the true shrinkage over a period (QuickBooks/Xero style);
    falls back to 5120 COGS when 5210 is absent. Stock is set by the caller; this only writes GL.
    Idempotent per adjustment: AUTO-INVADJ-{id}.
    """
    from api.services.station_stock import item_uses_station_bins

    adj = (
        InventoryAdjustment.objects.filter(pk=adjustment_id, company_id=company_id)
        .select_related("station")
        .first()
    )
    if not adj or adj.status != InventoryAdjustment.STATUS_POSTED:
        return False
    en = f"AUTO-INVADJ-{adjustment_id}"
    if JournalEntry.objects.filter(company_id=company_id, entry_number=en).exists():
        return True
    shrink = _coa(company_id, CODE_SHRINK_SHOP) or _coa(company_id, CODE_COGS_SHOP)
    if not shrink:
        # No shrinkage/COGS account configured: keep the physical stock change, skip GL.
        return True

    net_by_acc: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    acc_by_id: dict[int, ChartOfAccount] = {}
    for line in (
        InventoryAdjustmentLine.objects.filter(adjustment_id=adj.id).select_related("item")
    ):
        it = line.item
        if not it or not item_uses_station_bins(company_id, it):
            continue
        cost = line.unit_cost if line.unit_cost is not None else item_inventory_unit_cost(it)
        cost = cost or Decimal("0")
        if cost <= 0:
            continue
        book = line.book_quantity if line.book_quantity is not None else Decimal("0")
        counted = line.counted_quantity if line.counted_quantity is not None else Decimal("0")
        variance = counted - book
        if variance == 0:
            continue
        acc = _inventory_account_for_item(company_id, it)
        if not acc:
            continue
        net_by_acc[acc.id] += variance * cost
        acc_by_id[acc.id] = acc

    st_id = _gl_station_id(company_id, adj.station_id)
    st_name = (adj.station.station_name or f"ST-{adj.station_id}")[:80]
    desc = f"Inventory adjustment {adj.adjustment_number or adj.id} @ {st_name}"[:500]
    jlines: list[tuple] = []
    for acc_id, raw_net in sorted(net_by_acc.items()):
        net = raw_net.quantize(Decimal("0.01"))
        if net == 0:
            continue
        acc = acc_by_id[acc_id]
        if net > 0:
            jlines.append((acc, net, Decimal("0"), "Inventory count gain", st_id))
            jlines.append((shrink, Decimal("0"), net, "Inventory count gain", st_id))
        else:
            amt = -net
            jlines.append((shrink, amt, Decimal("0"), "Inventory shrinkage / loss", st_id))
            jlines.append((acc, Decimal("0"), amt, "Inventory shrinkage / loss", st_id))
    if not jlines:
        return True
    return (
        _create_posted_entry(company_id, adj.adjustment_date, en, desc, jlines, gl_station_id=None)
        is not None
    )


def delete_landlord_lease_payment_journal(company_id: int, landlord_ledger_entry_id: int) -> int:
    """Remove AUTO-LL-PAY-{id} if present (landlord subledger row deleted or re-synced)."""
    deleted, _ = JournalEntry.objects.filter(
        company_id=company_id,
        entry_number=f"AUTO-LL-PAY-{landlord_ledger_entry_id}",
    ).delete()
    return deleted


def sync_landlord_lease_payment_journal(
    company_id: int, ent: AquacultureLandlordLedgerEntry
) -> tuple[Optional[JournalEntry], Optional[str]]:
    """
    Cash-basis lease cost: Dr 6711 Aquaculture — Lease & Pond Rights (pond + lease bucket), Cr cash/bank.

    Runs when kind is payment, bank_account_id is set, and pond_id is set. Idempotent per ledger row id.
    Returns (journal, None) on success, (None, None) when skipped, or (None, error_message) on failure.
    """
    from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts

    en = f"AUTO-LL-PAY-{ent.id}"
    delete_landlord_lease_payment_journal(company_id, ent.id)
    AquacultureLandlordLedgerEntry.objects.filter(pk=ent.pk).update(journal_entry_id=None)

    if ent.kind != AquacultureLandlordLedgerEntry.KIND_PAYMENT:
        return None, None
    if not ent.bank_account_id:
        return None, None
    if not ent.pond_id:
        return (
            None,
            "bank_account_id requires pond_id so lease expense posts to the correct pond.",
        )
    mag = abs(ent.amount_signed or Decimal("0")).quantize(Decimal("0.01"))
    if mag <= 0:
        return None, None

    ensure_aquaculture_chart_accounts(company_id)
    lease_acc = _coa(company_id, CODE_AQ_LEASE_EXPENSE)
    if not lease_acc:
        return (
            None,
            "Chart account 6711 Aquaculture Expense — Lease & Pond Rights is missing. "
            "Enable Aquaculture for the company or run aquaculture COA seed.",
        )
    pm = (getattr(ent, "payment_method", None) or "cash").strip().lower() or "cash"
    credit_acc = _debit_account_for_paid_sale(company_id, pm, ent.bank_account_id)
    if not credit_acc:
        return (
            None,
            "No G/L credit account for this payment: link the bank register to a chart line or add 1010/1030.",
        )

    cycle_id = _default_open_cycle_id_for_pond(company_id, int(ent.pond_id))
    meta: dict[str, Any] = {"pond_id": int(ent.pond_id), "cost_bucket": "lease"}
    if cycle_id is not None:
        meta["production_cycle_id"] = cycle_id

    ll = ent.landlord
    ll_name = (ll.name or f"Landlord #{ent.landlord_id}").strip()[:120]
    base_memo = (ent.reference or ent.memo or f"Landlord payment — {ll_name}")[:300]
    desc = f"Aquaculture landlord lease payment — {ll_name}"[:500]
    lines = [
        (lease_acc, mag, Decimal("0"), base_memo),
        (credit_acc, Decimal("0"), mag, base_memo),
    ]
    aq_costing: list[Optional[dict]] = [meta, None]
    je = _create_posted_entry(
        company_id,
        ent.entry_date,
        en,
        desc,
        lines,
        gl_station_id=_gl_station_id(company_id, ent.station_id),
        aquaculture_line_costing=aq_costing,
    )
    if not je:
        return None, "Could not post landlord payment journal (unbalanced or invalid lines)."
    AquacultureLandlordLedgerEntry.objects.filter(pk=ent.pk).update(journal_entry_id=je.id)
    return je, None
