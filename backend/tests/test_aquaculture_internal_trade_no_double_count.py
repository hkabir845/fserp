"""
Guard: an inter-pond transfer must not double-count anywhere.

The trade produces three artefacts — the transfer journal, an invoice, and a bill — all describing
one movement of fish. Only the journal may reach the books. This sweeps every registered report
before and after a transfer and fails if a report that must not move, moves.

Company-level revenue, expense, A/R and A/P must be untouched: nothing left the business, and the
consolidation elimination nets the pond's margin back out. Fish must arrive exactly once.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureBiomassSample,
    AquacultureExpense,
    AquacultureFishStockLedger,
    AquaculturePond,
    Bill,
    ChartOfAccount,
    Company,
    Invoice,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_pond_internal_vendor import provision_pond_internal_parties
from tests.report_registry import ALL_API_REPORT_IDS


@pytest.fixture(autouse=True)
def _allow_legacy_fish_transfers(legacy_fish_transfers_enabled):
    """
    These cover the transfer machinery that historical records and the conversion still run
    through. The endpoint itself is retired for users — see test_fish_transfer_retired.
    """

START = "2026-01-01"
END = "2026-12-31"

# Reports that legitimately move: the transfer really happened, and pond profit centres are
# supposed to show it. Everything else changing means the internal trade leaked into a company
# total. The precise company figures are pinned in test_company_totals_do_not_move below.
EXPECTED_TO_MOVE: frozenset[str] = frozenset(
    {
        # The fish moved: operational aquaculture reports must reflect it.
        "aquaculture-biological-asset-ledger",
        "aquaculture-fcr-biomass",
        "aquaculture-fingerling-transfers",
        "aquaculture-fish-biomass-movements",
        "aquaculture-fish-growth",
        "aquaculture-fish-transfers",
        "aquaculture-pond-total-inventory",
        "aquaculture-sampling",
        "aquaculture-fish-stock-position",
        "aquaculture-fish-stock-breakdown",
        "aquaculture-pond-performance",
        "aquaculture-pond-pl",
        # The transfer journal is real GL: it belongs on the ledger-level statements.
        "balance-sheet",
        "trial-balance",
        # Pond profit centres: the seller earns the margin, the buyer capitalizes it.
        "ponds-pl-summary",
        "entities-balance-sheet-summary",
        "entities-financial-statement",
        "entities-financial-summary",
        "entities-pl-summary",
        "entities-trial-balance-summary",
        "financial-analytics",
        "cash-flow",
        # Internal trade is disclosed as its own block; the totals above it stay put.
        "income-statement",
        "income-detail",
        # The two ponds' internal trading identities are provisioned on first trade and appear
        # as (segregated) internal parties.
        "customer-balances",
    }
)

# (report id, dotted path, human reason) — company figures that must be identical before and
# after an internal trade. Nothing left the business, so none of these may move.
PINNED_COMPANY_FIGURES: tuple[tuple[str, str, str], ...] = (
    ("income-statement", "income.total", "internal trade is not company income"),
    ("income-statement", "cost_of_goods_sold.total", "internal cost of sales is not company COGS"),
    ("income-statement", "gross_profit", "no outside sale happened"),
    ("income-statement", "net_income", "the unrealized margin must be eliminated"),
    ("income-detail", "income.total", "internal revenue must stay out of company income"),
    ("cash-flow", "operating.net_income", "no cash moved and nothing was sold outside"),
    ("cash-flow", "cash_summary.ending_cash", "an internal trade settles without cash"),
    ("stations-financial-summary", "company_total.income", "no outside sale happened"),
    ("stations-financial-summary", "company_total.net_income", "no company profit was earned"),
    ("stations-financial-summary", "company_total.cost_of_goods_sold", "no outside cost was incurred"),
    ("sales-report", "summary.grand_total", "an internal invoice is not a sale"),
    ("sales-report", "summary.total_invoices", "an internal invoice is not a sale"),
    ("purchase-report", "summary.grand_total", "an internal bill is not a purchase"),
    ("purchase-report", "summary.total_bills", "an internal bill is not a purchase"),
)


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _pond(company_id: int, name: str, role: str) -> AquaculturePond:
    pond = AquaculturePond.objects.create(
        company_id=company_id, name=name, pond_role=role, is_active=True
    )
    provision_pond_internal_parties(company_id=company_id, pond=pond)
    pond.refresh_from_db()
    return pond


def _seed_1581(company_id: int, pond, amount: str) -> None:
    bio = ChartOfAccount.objects.filter(
        company_id=company_id, account_code="1581", is_active=True
    ).first()
    equity = ChartOfAccount.objects.filter(
        company_id=company_id, account_type="equity", is_active=True
    ).first()
    assert bio and equity
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_date=date(2026, 4, 2),
        entry_number=f"TEST-BIO-NDC-{pond.id}",
        description="Opening biological cost",
        is_posted=True,
    )
    JournalEntryLine.objects.create(
        journal_entry=je,
        account=bio,
        debit=Decimal(amount),
        credit=Decimal("0"),
        aquaculture_pond_id=pond.id,
    )
    JournalEntryLine.objects.create(
        journal_entry=je, account=equity, debit=Decimal("0"), credit=Decimal(amount)
    )


@pytest.fixture
def traded_ponds(company_tenant):
    cid = company_tenant.id
    _enable(company_tenant)
    ensure_aquaculture_chart_accounts(cid)
    nursing = _pond(cid, "Nursing NDC", "nursing")
    grow = _pond(cid, "Grow NDC", "grow_out")
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("10000.00"),
    )
    AquacultureFishStockLedger.objects.create(
        company_id=cid,
        pond=nursing,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=20000,
        weight_kg_delta=Decimal("400"),
        memo="Opening fingerlings",
    )
    _seed_1581(cid, nursing, "10000.00")
    return cid, nursing, grow


def _do_transfer(api_client, headers, nursing, grow):
    r = api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": nursing.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [{"to_pond_id": grow.id, "weight_kg": "100", "fish_count": 5000}],
            }
        ),
        content_type="application/json",
        **headers,
    )
    assert r.status_code == 201, r.content.decode()
    return json.loads(r.content)


def _snapshot_reports(api_client, headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for rid in ALL_API_REPORT_IDS:
        r = api_client.get(
            f"/api/reports/{rid}/", {"start_date": START, "end_date": END}, **headers
        )
        out[rid] = r.content.decode() if r.status_code == 200 else f"__status_{r.status_code}__"
    return out


@pytest.mark.django_db
def test_no_company_level_report_moves_on_an_internal_transfer(
    api_client, auth_admin_headers, traded_ponds
):
    cid, nursing, grow = traded_ponds
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}

    before = _snapshot_reports(api_client, h)
    _do_transfer(api_client, h, nursing, grow)
    after = _snapshot_reports(api_client, h)

    moved = {rid for rid in before if before[rid] != after[rid]}
    leaked = sorted(moved - EXPECTED_TO_MOVE)
    assert not leaked, (
        "these reports changed after an internal pond-to-pond transfer, which means the "
        f"internal invoice/bill leaked into a company total: {leaked}"
    )


@pytest.mark.django_db
def test_fish_arrive_exactly_once(api_client, auth_admin_headers, traded_ponds):
    from api.services.aquaculture_stock_service import compute_fish_stock_position_rows

    cid, nursing, grow = traded_ponds
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    _do_transfer(api_client, h, nursing, grow)

    buyer = compute_fish_stock_position_rows(cid, pond_id=grow.id, production_cycle_id=None)[0]
    seller = compute_fish_stock_position_rows(cid, pond_id=nursing.id, production_cycle_id=None)[0]
    assert int(buyer["implied_net_fish_count"]) == 5000
    assert Decimal(str(buyer["implied_net_weight_kg"])) == Decimal("100")
    assert int(seller["implied_net_fish_count"]) == 15000  # 20,000 opening less 5,000 moved
    # One sampling row per side of the move, never a third from the bill.
    assert AquacultureBiomassSample.objects.filter(source_bill_line__isnull=False).count() == 0
    assert AquacultureBiomassSample.objects.filter(pond_id=grow.id).count() == 1


@pytest.mark.django_db
def test_the_sale_hits_the_books_exactly_once(api_client, auth_admin_headers, traded_ponds):
    """
    The trade is on the books once: the seller's invoice journal and the buyer's bill journal,
    and nothing from the ordinary invoice/bill posting machinery on top.
    """
    cid, nursing, grow = traded_ponds
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    body = _do_transfer(api_client, h, nursing, grow)
    transfer_id = body["transfer"]["id"]
    docs = body["transfer"]["internal_documents"]
    sale = Decimal(body["transfer"]["lines"][0]["sale_amount"])

    from api.models import AquacultureFishPondTransferLine

    line_ids = list(
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).values_list(
            "id", flat=True
        )
    )
    entries = JournalEntry.objects.filter(company_id=cid, is_posted=True)
    trade_entries = sorted(
        e.entry_number for e in entries if e.entry_number.startswith("AUTO-IPT-")
    )
    expected = sorted(
        [f"AUTO-IPT-INV-{transfer_id}-{lid}" for lid in line_ids]
        + [f"AUTO-IPT-BILL-{transfer_id}-{lid}" for lid in line_ids]
    )
    assert trade_entries == expected, "one invoice journal and one bill journal per traded line"
    # The superseded transfer journal must not come back alongside them.
    assert not entries.filter(entry_number__startswith="AUTO-AQ-FISH-XFER-").exists()
    assert not entries.filter(entry_number__startswith="AUTO-INV-").exists()
    assert not entries.filter(entry_number__startswith="AUTO-BILL-").exists()

    # Internal revenue is recognized once, at the sale price.
    revenue = JournalEntryLine.objects.filter(
        journal_entry__company_id=cid,
        journal_entry__is_posted=True,
        account__account_code="4245",
    )
    assert sum((ln.credit or Decimal("0")) for ln in revenue) == sale

    # The documents exist and carry the same amount — evidence, not a second booking.
    assert Decimal(docs[0]["amount"]) == sale
    assert Invoice.all_objects.get(pk=docs[0]["invoice_id"]).total == sale
    assert Bill.all_objects.get(pk=docs[0]["bill_id"]).total == sale


@pytest.mark.django_db
def test_internal_bill_line_stays_out_of_the_pond_expense_pool(
    api_client, auth_admin_headers, traded_ponds
):
    """The buying pond capitalized the price in 1581; billing it again would be the same cost twice."""
    from api.services.aquaculture_cost_per_kg import posted_pond_vendor_bill_lines_qs

    cid, nursing, grow = traded_ponds
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}
    _do_transfer(api_client, h, nursing, grow)

    bill = Bill.all_objects.get(internal_fish_transfer_line__isnull=False)
    line = bill.lines.first()
    assert line.aquaculture_pond_id is None, "an internal document must not be pond-tagged"

    assert not posted_pond_vendor_bill_lines_qs(
        company_id=cid,
        pond_id=grow.id,
        start=date(2026, 1, 1),
        end=date(2026, 12, 31),
        cycle_filter_id=None,
    ).exists()


def _dig(payload, path: str):
    cur = payload
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return "__missing__"
        cur = cur[part]
    return cur


@pytest.mark.django_db
def test_company_totals_do_not_move(api_client, auth_admin_headers, traded_ponds):
    """The sharp version of the sweep: named company figures, pinned before and after."""
    cid, nursing, grow = traded_ponds
    h = {**auth_admin_headers, "HTTP_X_COMPANY_ID": str(cid)}

    def figures() -> dict[tuple[str, str], object]:
        out: dict[tuple[str, str], object] = {}
        for rid, path, _reason in PINNED_COMPANY_FIGURES:
            r = api_client.get(
                f"/api/reports/{rid}/", {"start_date": START, "end_date": END}, **h
            )
            assert r.status_code == 200, (rid, r.status_code)
            out[(rid, path)] = _dig(json.loads(r.content), path)
        return out

    before = figures()
    body = _do_transfer(api_client, h, nursing, grow)
    sale = Decimal(body["transfer"]["lines"][0]["sale_amount"])
    assert sale > 0, "the trade must actually be priced for this test to mean anything"
    after = figures()

    for rid, path, reason in PINNED_COMPANY_FIGURES:
        key = (rid, path)
        assert before[key] != "__missing__", f"{rid}.{path} not found — fix the pinned path"
        assert before[key] == after[key], (
            f"{rid}.{path} moved from {before[key]} to {after[key]} after an internal "
            f"pond-to-pond trade of {sale}: {reason}"
        )
