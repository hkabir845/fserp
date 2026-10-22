"""Charge to stays consistent across bill lists, accounting, edits and reports."""
import io
import json
from datetime import date
from decimal import Decimal

import pytest
from django.core.management import call_command

from api.models import AquaculturePond, Bill, ChartOfAccount, JournalEntry, Station, Vendor
from api.services.bill_list_allocations import bill_filtered_line_amount, summarize_bill_entity_allocations
from api.services.gl_posting import resync_posted_bill_journal_from_lines
from api.services.reporting import report_income_expense_statement

DAY = date(2026, 10, 19)


def post(api_client, headers, vendor, lines, **extra):
    response = api_client.post('/api/bills/', data=json.dumps({
        'vendor_id': vendor.id, 'bill_date': DAY.isoformat(), 'status': 'open',
        'bill_purpose': 'mixed', 'lines': lines, **extra,
    }), content_type='application/json', **headers)
    assert response.status_code == 201, response.content
    return Bill.objects.get(pk=response.json()['id'])


def cost(description, amount, **tags):
    return {'description': description, 'quantity': 1, 'unit_cost': str(amount),
            'amount': str(amount), **tags}


@pytest.mark.django_db
def test_charge_to_overrides_vendor_and_header_everywhere(api_client, company_tenant_with_gl, auth_admin_headers):
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name='Adib')
    other = Station.objects.create(company=company, station_name='Other site')
    pond = AquaculturePond.objects.create(company=company, name='Mynuddin Pond')
    vendor = Vendor.objects.create(company=company, display_name='Electricity vendor', default_station=station)
    bill = post(api_client, auth_admin_headers, vendor, [
        cost('Office power', 100, charge_to_head_office=True),
        cost('Other site power', 200, line_receipt_station_id=other.id),
        cost('Pond power', 300, aquaculture_pond_id=pond.id),
    ])
    assert bill.receipt_station_id == station.id  # Physical receipt default is separate.
    assert {row['entity_scope_key']: Decimal(row['amount']) for row in summarize_bill_entity_allocations(bill)} == {
        'ho': Decimal('100'), str(other.id): Decimal('200'), f'p:{pond.id}': Decimal('300'),
    }
    # The header must not leak the receiving station onto any charged entity.
    entry = JournalEntry.objects.get(company=company, entry_number=f'AUTO-BILL-{bill.id}')
    assert entry.station_id is None
    for debit, credit in [(True, False), (False, True)]:
        rows = entry.lines.filter(debit__gt=0) if debit else entry.lines.filter(credit__gt=0)
        amount_field = 'debit' if debit else 'credit'
        assert set(rows.values_list('station_id', 'aquaculture_pond_id', amount_field)) == {
            (None, None, Decimal('100')), (other.id, None, Decimal('200')), (None, pond.id, Decimal('300')),
        }
    def scoped(**scope):
        response = api_client.get('/api/bills/', scope, **auth_admin_headers)
        assert response.status_code == 200, response.content
        return response.json()
    assert str(bill.id) not in [str(row['id']) for row in scoped(station_id=station.id)]
    assert bill.id in [row['id'] for row in scoped(station_id=other.id)]
    assert bill.id in [row['id'] for row in scoped(head_office='1')]
    assert bill_filtered_line_amount(bill, station_id=other.id, pond_id=None, head_office=False) == Decimal('200')
    assert bill_filtered_line_amount(bill, station_id=None, pond_id=None, head_office=True) == Decimal('100')
    assert Decimal(report_income_expense_statement(company.id, DAY, DAY, station_id=station.id)['total_expense']) == 0
    assert Decimal(report_income_expense_statement(company.id, DAY, DAY, station_id=other.id)['total_expense']) == 200
    assert Decimal(report_income_expense_statement(company.id, DAY, DAY, unscoped_dims=True)['total_expense']) == 100
    assert Decimal(report_income_expense_statement(company.id, DAY, DAY, pond_id=pond.id)['total_expense']) == 300
    from api.services.reporting import _sum_bill_totals_non_draft, report_vendor_balances, report_purchase_report
    assert _sum_bill_totals_non_draft(company.id, DAY, DAY, station_id=other.id) == 200
    assert Decimal(report_vendor_balances(company.id, DAY, DAY, station_id=other.id)['total_ap']) == 200
    assert Decimal(report_vendor_balances(company.id, DAY, DAY, pond_id=pond.id)['total_ap']) == 300
    assert Decimal(report_purchase_report(company.id, DAY, DAY, station_id=other.id)['summary']['grand_total']) == 200


@pytest.mark.django_db
def test_editing_pond_to_station_to_office_clears_old_dimensions(api_client, company_tenant_with_gl, auth_admin_headers):
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name='Adib')
    pond = AquaculturePond.objects.create(company=company, name='Pond')
    vendor = Vendor.objects.create(company=company, display_name='Vendor', default_station=station)
    bill = post(api_client, auth_admin_headers, vendor, [cost('Power', 100, aquaculture_pond_id=pond.id)])
    for tags in [{'line_receipt_station_id': station.id}, {'charge_to_head_office': True}]:
        response = api_client.put(f'/api/bills/{bill.id}/', data=json.dumps({
            'lines': [cost('Power', 100, **tags)], 'bill_purpose': 'mixed',
        }), content_type='application/json', **auth_admin_headers)
        assert response.status_code == 200, response.content
        entry = JournalEntry.objects.get(company=company, entry_number=f'AUTO-BILL-{bill.id}')
        expected = station.id if 'line_receipt_station_id' in tags else None
        assert entry.station_id == expected
        assert set(entry.lines.values_list('station_id', 'aquaculture_pond_id')) == {(expected, None)}
        assert sum(entry.lines.values_list('debit', flat=True)) == sum(entry.lines.values_list('credit', flat=True)) == 100
        returned = response.json()['lines'][0]
        assert returned['charge_to_entity_key'] == (str(station.id) if expected else 'ho')
    # Reposting never replaces an explicit office choice with the vendor's station.
    assert resync_posted_bill_journal_from_lines(company.id, bill.id)
    entry.refresh_from_db()
    assert entry.station_id is None


@pytest.mark.django_db
def test_tax_and_payable_follow_each_charge_to(api_client, company_tenant_with_gl, auth_admin_headers):
    from api.models import Payment, PaymentBillAllocation
    from api.services.gl_posting import sync_payment_made_gl
    from api.services.payment_station import payment_site_display_label
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name='Adib')
    vendor = Vendor.objects.create(company=company, display_name='Vendor', default_station=station)
    bill = post(api_client, auth_admin_headers, vendor, [
        cost('Office power', 100, charge_to_head_office=True),
        cost('Station power', 200, line_receipt_station_id=station.id),
    ], tax_amount='30')
    entry = JournalEntry.objects.get(company=company, entry_number=f'AUTO-BILL-{bill.id}')
    assert set(entry.lines.filter(credit__gt=0).values_list('station_id', 'credit')) == {
        (None, Decimal('110')), (station.id, Decimal('220')),
    }
    assert set(entry.lines.filter(account__account_code='1170').values_list('station_id', 'debit')) == {
        (None, Decimal('10')), (station.id, Decimal('20')),
    }
    payment = Payment.objects.create(company=company, vendor=vendor, payment_type='made',
                                     payment_date=DAY, amount=Decimal('165'), payment_method='cash')
    PaymentBillAllocation.objects.create(payment=payment, bill=bill, amount=Decimal('165'))
    assert sync_payment_made_gl(company.id, payment)
    paid_entry = JournalEntry.objects.get(company=company, entry_number=f'AUTO-PAY-{payment.id}-MADE')
    assert set(paid_entry.lines.filter(debit__gt=0).values_list('station_id', 'debit')) == {
        (None, Decimal('55')), (station.id, Decimal('110')),
    }
    assert set(payment_site_display_label(company.id, payment).split(', ')) == {'Head office', 'Adib'}
    # Simulate a legacy journal stamped to the receipt station; sync is dry by default.
    JournalEntry.objects.filter(pk=entry.pk).update(station=station)
    entry.lines.filter(station_id__isnull=True).update(station=station)
    paid_entry.lines.filter(station_id__isnull=True).update(station=station)
    legacy_account = ChartOfAccount.objects.create(company=company, account_code='6999',
                                                    account_name='Legacy expense', account_type='expense')
    entry.lines.filter(debit=100).update(account=legacy_account)
    opts = dict(company_id=company.id, through=DAY, bill_id=[bill.id])
    call_command('sync_bill_charge_to_entities', **opts, stdout=io.StringIO())
    entry.refresh_from_db()
    assert entry.station_id == station.id
    call_command('sync_bill_charge_to_entities', **opts, apply=True, stdout=io.StringIO())
    entry.refresh_from_db()
    assert entry.station_id is None
    assert entry.lines.get(debit=100).account_id == legacy_account.id
    assert set(paid_entry.lines.filter(debit__gt=0).values_list('station_id', 'debit')) == {
        (None, Decimal('55')), (station.id, Decimal('110')),
    }
    out = io.StringIO()
    call_command('sync_bill_charge_to_entities', **opts, apply=True, stdout=out)
    assert json.loads(out.getvalue())['changed_bill_count'] == 0


@pytest.mark.django_db
def test_historical_sync_reports_incompatible_line_amounts(api_client, company_tenant_with_gl, auth_admin_headers):
    from api.models import JournalEntryLine
    company = company_tenant_with_gl
    station = Station.objects.create(company=company, station_name='Adib')
    vendor = Vendor.objects.create(company=company, display_name='Vendor', default_station=station)
    bill = post(api_client, auth_admin_headers, vendor, [
        cost('Office power', 40, charge_to_head_office=True),
        cost('Station power', 60, line_receipt_station_id=station.id),
    ])
    entry = JournalEntry.objects.get(company=company, entry_number=f'AUTO-BILL-{bill.id}')
    debits = list(entry.lines.filter(debit__gt=0).order_by('id'))
    other_account = ChartOfAccount.objects.create(company=company, account_code='6998',
                                                   account_name='Legacy second expense', account_type='expense')
    entry.lines.filter(pk=debits[0].pk).update(debit=50)
    entry.lines.filter(pk=debits[1].pk).update(debit=50, account=other_account)
    out = io.StringIO()
    call_command('sync_bill_charge_to_entities', company_id=company.id, through=DAY,
                 bill_id=[bill.id], apply=True, stdout=out)
    result = json.loads(out.getvalue())
    assert result['changed_bill_count'] == 0
    assert result['skipped_bill_count'] == 1
    assert result['skipped_bills'][0]['bill_id'] == bill.id
    assert entry.lines.filter(debit=50).count() == 2


@pytest.mark.django_db
def test_conflicting_office_choice_is_rejected(api_client, company_tenant_with_gl, auth_admin_headers):
    station = Station.objects.create(company=company_tenant_with_gl, station_name='Adib')
    vendor = Vendor.objects.create(company=company_tenant_with_gl, display_name='Vendor')
    response = api_client.post('/api/bills/', data=json.dumps({
        'vendor_id': vendor.id, 'bill_date': DAY.isoformat(), 'status': 'open',
        'lines': [cost('Power', 100, charge_to_head_office=True, line_receipt_station_id=station.id)],
    }), content_type='application/json', **auth_admin_headers)
    assert response.status_code == 400
    assert not Bill.objects.filter(company=company_tenant_with_gl).exists()


@pytest.mark.django_db
def test_shop_cost_bucket_does_not_override_charge_to_or_duplicate_cost(api_client, company_tenant_with_gl, auth_admin_headers):
    from api.services.reporting import report_income_statement
    company = company_tenant_with_gl
    shop = Station.objects.create(company=company, station_name='Premium Agro', operates_fuel_retail=False)
    vendor = Vendor.objects.create(company=company, display_name='Vendor', default_station=shop)
    account, _ = ChartOfAccount.objects.get_or_create(company=company, account_code='6714', defaults={
        'account_name': 'Aquaculture transportation', 'account_type': 'expense',
    })
    post(api_client, auth_admin_headers, vendor, [
        cost('Shop transportation', 100, line_receipt_station_id=shop.id,
             aquaculture_cost_bucket='transportation', expense_account_id=account.id),
        cost('Office transportation', 50, charge_to_head_office=True, expense_account_id=account.id),
    ])
    sheet = report_income_expense_statement(company.id, DAY, DAY)
    assert Decimal(sheet['total_expense']) == 150
    assert {(row['entity_name'], Decimal(row['expense'])) for row in sheet['lines']} == {
        ('Premium Agro', Decimal('100')), ('Head office / unassigned', Decimal('50')),
    }
    pl = report_income_statement(company.id, DAY, DAY)
    assert Decimal(pl['total_expenses']) == 150
    assert not any('unallocated' in row.get('entity_name', '').lower() for row in sheet['lines'])
