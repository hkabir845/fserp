"""Inter-pond transfers priced as internal sales: cost per kg plus the company margin."""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest

from api.models import (
    AquacultureExpense,
    ChartOfAccount,
    AquacultureFishPondTransfer,
    AquacultureFishStockLedger,
    AquaculturePond,
    Company,
    JournalEntry,
    JournalEntryLine,
)
from api.services.aquaculture_coa_seed import ensure_aquaculture_chart_accounts
from api.services.aquaculture_internal_transfer_price import (
    apply_internal_prices_to_transfer,
    internal_transfer_margin_per_kg,
    quote_internal_transfer_line,
)


@pytest.fixture(autouse=True)
def _allow_legacy_fish_transfers(legacy_fish_transfers_enabled):
    """
    These cover the transfer machinery that historical records and the conversion still run
    through. The endpoint itself is retired for users — see test_fish_transfer_retired.
    """


def _enable(c: Company) -> None:
    Company.objects.filter(pk=c.id).update(aquaculture_enabled=True, aquaculture_licensed=True)


def _headers(base: dict, company_id: int) -> dict:
    return {**base, "HTTP_X_COMPANY_ID": str(company_id)}


def _seed_pond_fish(company_id: int, pond, *, heads: int, kg: str) -> None:
    """Stock the source pond so the outbound transfer passes the stock guard."""
    AquacultureFishStockLedger.objects.create(
        company_id=company_id,
        pond=pond,
        entry_date=date(2026, 4, 1),
        entry_kind="adjustment",
        fish_species="tilapia",
        fish_count_delta=heads,
        weight_kg_delta=Decimal(kg),
        memo="Opening fingerlings for margin test",
    )


def _seed_pond_1581_balance(company_id: int, pond, amount: str) -> None:
    """Put real capitalized cost in the pond's 1581 so a transfer has book cost to relieve."""
    bio = ChartOfAccount.objects.filter(
        company_id=company_id, account_code="1581", is_active=True
    ).first()
    equity = ChartOfAccount.objects.filter(
        company_id=company_id, account_type="equity", is_active=True
    ).first()
    assert bio and equity, "aquaculture chart accounts must be seeded first"
    je = JournalEntry.objects.create(
        company_id=company_id,
        entry_date=date(2026, 4, 2),
        entry_number=f"TEST-BIO-OPEN-{pond.id}",
        description="Opening biological cost for margin test",
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
        journal_entry=je,
        account=equity,
        debit=Decimal("0"),
        credit=Decimal(amount),
    )


def _journal_lines(company_id: int, transfer_id: int) -> dict[str, tuple[Decimal, Decimal]]:
    """
    {account_code: (total debit, total credit)} across the trade's paperwork.

    An inter-pond fish move posts as a seller invoice plus a buyer bill, so the economics are
    spread over both journals; totalling them is what makes the trade readable as one event.
    """
    from api.models import AquacultureFishPondTransferLine

    line_ids = list(
        AquacultureFishPondTransferLine.objects.filter(transfer_id=transfer_id).values_list(
            "id", flat=True
        )
    )
    wanted: list[str] = []
    for lid in line_ids:
        wanted += [f"AUTO-IPT-INV-{transfer_id}-{lid}", f"AUTO-IPT-BILL-{transfer_id}-{lid}"]
    entries = list(JournalEntry.objects.filter(company_id=company_id, entry_number__in=wanted))
    if not entries:
        return {}
    out: dict[str, tuple[Decimal, Decimal]] = {}
    for ln in JournalEntryLine.objects.filter(journal_entry__in=entries).select_related("account"):
        code = ln.account.account_code
        d, c = out.get(code, (Decimal("0"), Decimal("0")))
        out[code] = (d + (ln.debit or Decimal("0")), c + (ln.credit or Decimal("0")))
    return out


def _post_transfer(api_client, headers, *, from_pond, to_pond, weight_kg: str, fish_count: int):
    return api_client.post(
        "/api/aquaculture/fish-pond-transfers/",
        data=json.dumps(
            {
                "from_pond_id": from_pond.id,
                "transfer_date": "2026-05-17",
                "fish_species": "tilapia",
                "lines": [
                    {
                        "to_pond_id": to_pond.id,
                        "weight_kg": weight_kg,
                        "fish_count": fish_count,
                    }
                ],
            }
        ),
        content_type="application/json",
        **headers,
    )


@pytest.mark.django_db
def test_margin_defaults_to_twenty_taka_per_kg(company_tenant):
    assert internal_transfer_margin_per_kg(company_tenant.id) == Decimal("20")


@pytest.mark.django_db
def test_quote_is_cost_per_kg_plus_margin(company_tenant):
    cid = company_tenant.id
    # 100 kg costing 10,000 = 100/kg; with the default 20 margin it sells at 120/kg.
    rate, amount, basis = quote_internal_transfer_line(
        cid, cost_amount=Decimal("10000.00"), weight_kg=Decimal("100")
    )
    assert rate == Decimal("120.0000")
    assert amount == Decimal("12000.00")
    assert "Cost 100.0000/kg" in basis and "margin 20.0000/kg" in basis

    # A hand-entered rate overrules the rule and says so.
    rate, amount, basis = quote_internal_transfer_line(
        cid,
        cost_amount=Decimal("10000.00"),
        weight_kg=Decimal("100"),
        override_rate_per_kg=Decimal("150"),
    )
    assert rate == Decimal("150.0000")
    assert amount == Decimal("15000.00")
    assert "by hand" in basis


@pytest.mark.django_db
def test_zero_margin_moves_fish_at_cost_as_before(company_tenant):
    cid = company_tenant.id
    Company.objects.filter(pk=cid).update(aquaculture_internal_transfer_margin_per_kg=Decimal("0"))
    rate, amount, _ = quote_internal_transfer_line(
        cid, cost_amount=Decimal("10000.00"), weight_kg=Decimal("100")
    )
    assert rate == Decimal("100.0000")
    assert amount == Decimal("10000.00")


@pytest.mark.django_db
def test_transfer_posts_an_internal_sale_with_margin(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    ensure_aquaculture_chart_accounts(cid)
    h = _headers(auth_admin_headers, cid)
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Margin", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Margin", pond_role="grow_out", is_active=True
    )
    # Capitalized fry cost gives the nursing pond a 1581 balance to relieve.
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("10000.00"),
        memo="fry",
    )
    _seed_pond_fish(cid, nursing, heads=10000, kg="200")
    _seed_pond_1581_balance(cid, nursing, "10000.00")

    r = _post_transfer(
        api_client, h, from_pond=nursing, to_pond=grow, weight_kg="100", fish_count=5000
    )
    assert r.status_code == 201, r.content.decode()
    payload = json.loads(r.content)["transfer"]
    transfer_id = payload["id"]

    line = payload["lines"][0]
    cost = Decimal(line["cost_amount"])
    sale = Decimal(line["sale_amount"])
    assert cost > 0, "the nursing pond should carry a cost to sell against"
    # 20/kg on 100 kg is the margin, whatever the underlying cost works out to.
    assert sale - cost == Decimal("2000.00")
    assert Decimal(line["margin_amount"]) == Decimal("2000.00")
    assert Decimal(line["sale_rate_per_kg"]) == (cost / Decimal("100")).quantize(
        Decimal("0.0001")
    ) + Decimal("20")
    assert Decimal(payload["margin_total"]) == Decimal("2000.00")
    assert payload["internal_margin_per_kg"] == "20.0000"

    codes = _journal_lines(cid, transfer_id)
    assert codes["4245"][1] == sale, "internal revenue is credited at the sale price"
    assert codes["5245"][0] == cost, "internal cost of sales is debited at cost"
    # 1581: buying pond capitalizes the price, selling pond releases the cost.
    assert codes["1581"] == (sale, cost)
    total_debit = sum(d for d, _ in codes.values())
    total_credit = sum(c for _, c in codes.values())
    assert total_debit == total_credit


@pytest.mark.django_db
def test_zero_margin_still_documents_a_sale_but_earns_nothing(
    api_client, company_tenant, auth_admin_headers
):
    """
    At zero margin the ponds still trade — the paperwork is a sale at cost, not a silent re-tag
    of inventory. The selling pond simply makes nothing on it.
    """
    _enable(company_tenant)
    cid = company_tenant.id
    ensure_aquaculture_chart_accounts(cid)
    Company.objects.filter(pk=cid).update(aquaculture_internal_transfer_margin_per_kg=Decimal("0"))
    h = _headers(auth_admin_headers, cid)
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing AtCost", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow AtCost", pond_role="grow_out", is_active=True
    )
    AquacultureExpense.objects.create(
        company_id=cid,
        pond=nursing,
        expense_date=date(2026, 4, 1),
        expense_category="fry_stocking",
        amount=Decimal("10000.00"),
    )
    _seed_pond_fish(cid, nursing, heads=10000, kg="200")
    _seed_pond_1581_balance(cid, nursing, "10000.00")

    r = _post_transfer(
        api_client, h, from_pond=nursing, to_pond=grow, weight_kg="100", fish_count=5000
    )
    assert r.status_code == 201, r.content.decode()
    transfer_id = json.loads(r.content)["transfer"]["id"]

    codes = _journal_lines(cid, transfer_id)
    assert codes["4245"][1] == codes["5245"][0], "sold at cost, so revenue equals cost of sales"
    assert codes["1581"][0] == codes["1581"][1], "no margin, so the buyer capitalizes the cost"
    assert codes["1595"][0] == codes["1595"][1], "the two ponds settle against each other"


@pytest.mark.django_db
def test_pond_with_no_book_cost_still_earns_the_margin(
    api_client, company_tenant, auth_admin_headers
):
    """A pond that expensed its costs has nothing in 1581 — the whole price is its margin."""
    _enable(company_tenant)
    cid = company_tenant.id
    ensure_aquaculture_chart_accounts(cid)
    Company.objects.filter(pk=cid).update(
        aquaculture_capitalize_pond_consumption_to_bioasset=False
    )
    h = _headers(auth_admin_headers, cid)
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing NoBook", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow NoBook", pond_role="grow_out", is_active=True
    )
    _seed_pond_fish(cid, nursing, heads=5000, kg="100")

    r = _post_transfer(
        api_client, h, from_pond=nursing, to_pond=grow, weight_kg="50", fish_count=2500
    )
    assert r.status_code == 201, r.content.decode()
    payload = json.loads(r.content)["transfer"]
    transfer_id = payload["id"]

    line = payload["lines"][0]
    assert Decimal(line["cost_amount"]) == Decimal("0.00")
    assert Decimal(line["sale_amount"]) == Decimal("1000.00")  # 50 kg x 20/kg
    assert Decimal(line["sale_rate_per_kg"]) == Decimal("20.0000")

    codes = _journal_lines(cid, transfer_id)
    assert codes["4245"][1] == Decimal("1000.00")
    assert codes["1581"][0] == Decimal("1000.00")
    assert "5245" not in codes, "nothing in 1581 to relieve, so no internal cost of sales"


@pytest.mark.django_db
def test_repricing_follows_a_changed_cost(company_tenant):
    _enable(company_tenant)
    cid = company_tenant.id
    nursing = AquaculturePond.objects.create(
        company_id=cid, name="Nursing Reprice", pond_role="nursing", is_active=True
    )
    grow = AquaculturePond.objects.create(
        company_id=cid, name="Grow Reprice", pond_role="grow_out", is_active=True
    )
    xfer = AquacultureFishPondTransfer.objects.create(
        company_id=cid, from_pond=nursing, transfer_date=date(2026, 5, 17), fish_species="tilapia"
    )
    line = xfer.lines.create(
        to_pond=grow, weight_kg=Decimal("100"), fish_count=5000, cost_amount=Decimal("10000.00")
    )

    apply_internal_prices_to_transfer(cid, xfer)
    line.refresh_from_db()
    assert line.sale_rate_per_kg == Decimal("120.0000")
    assert line.sale_amount == Decimal("12000.00")

    line.cost_amount = Decimal("15000.00")
    line.save(update_fields=["cost_amount"])
    apply_internal_prices_to_transfer(cid, xfer)
    line.refresh_from_db()
    assert line.sale_rate_per_kg == Decimal("170.0000")  # 150/kg cost + 20 margin
    assert line.sale_amount == Decimal("17000.00")


@pytest.mark.django_db
def test_company_api_changes_the_margin_and_rejects_a_negative(
    api_client, company_tenant, auth_admin_headers
):
    _enable(company_tenant)
    cid = company_tenant.id
    h = _headers(auth_admin_headers, cid)

    ok = api_client.put(
        f"/api/companies/{cid}/",
        data=json.dumps({"aquaculture_internal_transfer_margin_per_kg": "35.5"}),
        content_type="application/json",
        **h,
    )
    assert ok.status_code == 200, ok.content.decode()
    assert json.loads(ok.content)["aquaculture_internal_transfer_margin_per_kg"] == "35.5000"
    assert internal_transfer_margin_per_kg(cid) == Decimal("35.5000")

    bad = api_client.put(
        f"/api/companies/{cid}/",
        data=json.dumps({"aquaculture_internal_transfer_margin_per_kg": "-5"}),
        content_type="application/json",
        **h,
    )
    assert bad.status_code == 400
    assert "cannot be negative" in bad.content.decode()
